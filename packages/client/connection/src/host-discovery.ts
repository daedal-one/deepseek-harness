/** One Connection activation's coalesced, bounded and cancellable discovery scans. */
import { z } from 'zod'
import type { ConnectionIdentity, ConnectionHostId } from './host-identity-protocol.ts'
import { HostDiscoveryConfigSchema, type HostDiscoveryConfig } from './discovery-config.ts'
import { TailscaleUnavailable, type HostDiscoveryIo } from './discovery-io.ts'
import { hostAdvertisementSchema, isTailnetAddress, tailnetOriginSchema,
  type HostDiscoveryCandidate, type HostDiscoveryResult, type TailnetOrigin } from './discovery-protocol.ts'

const peerSchema = z.object({ Online: z.boolean().optional(), TailscaleIPs: z.array(z.string()).nullish() })
const statusSchema = z.object({
  BackendState: z.string(), Self: peerSchema.nullish(), Peer: z.record(z.string(), peerSchema).nullish(),
})
interface Scan {
  readonly controller: AbortController
  readonly done: Promise<HostDiscoveryResult>
  waiters: number
  settled: boolean
}

/** Owns status execution, probe lifetimes and a completed-result cache. */
export class HostDiscovery {
  private readonly config: HostDiscoveryConfig
  private pending: Scan | undefined
  private cached: { result: HostDiscoveryResult; expires: number } | undefined
  private closed = false

  /**
   * @param identity - authenticated assisting Host identity.
   * @param config - explicit deployment limits, validated before first use.
   * @param io - physical Host status and HTTP operations; each settles after owned cleanup.
   */
  constructor(private readonly identity: ConnectionIdentity, config: HostDiscoveryConfig, private readonly io: HostDiscoveryIo) {
    this.config = HostDiscoveryConfigSchema(config)
    if (!hostAdvertisementSchema.safeParse({ version: 1, identity, label: config.label }).success) {
      throw new Error('Discovery requires a non-empty public label')
    }
  }

  /**
   * Join one scan with an independent caller lifetime; never accept caller targets.
   * @param signal - caller or device authorization lifetime.
   * @returns completed metadata, or rejects when this caller is cancelled or the owner is disposed.
   */
  async scan(signal: AbortSignal): Promise<HostDiscoveryResult> {
    signal.throwIfAborted()
    if (this.closed) throw new Error('Discovery is disposed')
    if (this.pending?.controller.signal.aborted === true) {
      await this.pending.done
      return this.scan(signal)
    }
    if (this.cached !== undefined && performance.now() < this.cached.expires) return this.cached.result
    const scan = this.pending ?? this.start()
    scan.waiters++
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (result?: HostDiscoveryResult): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        scan.waiters--
        if (scan.waiters === 0 && !scan.settled) scan.controller.abort(new Error('Discovery has no callers'))
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- preserve arbitrary caller AbortSignal reasons
        if (result === undefined) reject(signal.reason)
        else if (this.closed) reject(new Error('Discovery is disposed'))
        else resolve(result)
      }
      const abort = (): void => { finish() }
      signal.addEventListener('abort', abort, { once: true })
      void scan.done.then((result) => { finish(result) })
    })
  }

  /** Stop admission and await all owned process and HTTP completion. */
  async dispose(): Promise<void> {
    this.closed = true
    this.cached = undefined
    const pending = this.pending
    pending?.controller.abort(new Error('Discovery is disposed'))
    await pending?.done
  }

  private start(): Scan {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(new Error('Discovery timed out')) }, this.config.scanTimeoutMs)
    const scan: Scan = {
      controller, waiters: 0, settled: false,
      done: Promise.resolve().then(() => this.collect(controller.signal)).catch((error: unknown) => this.result(
        error instanceof TailscaleUnavailable ? 'tailscale-unavailable' : 'scan-failed',
      )).then((result) => {
        if (!this.closed && !controller.signal.aborted) {
          this.cached = { result, expires: performance.now() + this.config.cacheTtlMs }
        }
        return result
      }).finally(() => {
        clearTimeout(timer)
        scan.settled = true
        this.pending = undefined
      }),
    }
    this.pending = scan
    return scan
  }

  private result(status: HostDiscoveryResult['status'], candidates: HostDiscoveryCandidate[] = [], truncated = false): HostDiscoveryResult {
    return { version: 1, host: this.identity, status, candidates, truncated }
  }

  private async collect(signal: AbortSignal): Promise<HostDiscoveryResult> {
    const cancelled = (): boolean => signal.aborted
    const raw = await this.io.readStatus(signal)
    signal.throwIfAborted()
    const status = statusSchema.parse(raw)
    if (status.BackendState !== 'Running') return this.result('tailscale-disconnected')
    const addresses = new Set<string>()
    for (const peer of [status.Self, ...Object.values(status.Peer ?? {}).filter(peer => peer.Online === true)]) {
      for (const address of peer?.TailscaleIPs ?? []) if (isTailnetAddress(address)) addresses.add(address)
    }
    const ports = [...new Set(this.config.ports)].sort((a, b) => a - b)
    const targets: TailnetOrigin[] = []
    const ordered = [...addresses].sort()
    const truncated = ordered.length * ports.length > this.config.maxProbes
    targetsLoop: for (const address of ordered) {
      for (const port of ports) {
        if (targets.length === this.config.maxProbes) break targetsLoop
        const host = address.includes(':') ? `[${address}]` : address
        targets.push(tailnetOriginSchema.parse(new URL(`http://${host}:${String(port)}`).origin))
      }
    }
    let next = 0
    const candidates: HostDiscoveryCandidate[] = []
    const worker = async (): Promise<void> => {
      while (!cancelled()) {
        const origin = targets[next++]
        if (origin === undefined) return
        let rawAdvertisement: unknown
        try { rawAdvertisement = await this.io.probe(origin, signal) }
        catch { continue } // Offline, incompatible and malformed peers do not abort other probes.
        const advertisement = hostAdvertisementSchema.safeParse(rawAdvertisement)
        if (advertisement.success && !cancelled()) candidates.push({ ...advertisement.data, origin })
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.config.concurrency, targets.length) }, worker))
    signal.throwIfAborted()
    const unique = new Map<ConnectionHostId, HostDiscoveryCandidate>()
    for (const candidate of candidates) {
      const previous = unique.get(candidate.identity.hostId)
      if (previous === undefined || previous.origin < candidate.origin) unique.set(candidate.identity.hostId, candidate)
    }
    return this.result('ready', [...unique.values()].sort((a, b) => a.identity.hostId.localeCompare(b.identity.hostId, 'en')), truncated)
  }
}
