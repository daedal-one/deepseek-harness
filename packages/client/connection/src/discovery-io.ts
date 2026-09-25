/** Local status process and credential-free, bounded advertisement HTTP reads. */
import { Agent } from 'undici'
import { spawn } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { HostDiscoveryConfig } from './discovery-config.ts'
import { HOST_ADVERTISEMENT_PATH, type TailnetOrigin } from './discovery-protocol.ts'

/** Missing local Tailscale installation; details never enter the Client response. */
export class TailscaleUnavailable extends Error {}

/** External operations owned and awaited by a discovery scan. */
export interface HostDiscoveryIo {
  /**
   * Read bounded local status; settle only after the status process closes.
   * @param signal - scan cancellation.
   * @returns parsed status JSON; rejects on cancellation, limit or process failure.
   */
  readStatus(this: void, signal: AbortSignal): Promise<unknown>
  /**
   * Read one bounded response without redirects, cookies or authorization.
   * @param origin - validated numeric tailnet origin.
   * @param signal - scan cancellation.
   * @returns parsed advertisement JSON after response cleanup.
   */
  probe(this: void, origin: TailnetOrigin, signal: AbortSignal): Promise<unknown>
}

/**
 * Compose the physical Host's local Tailscale command and anonymous HTTP client.
 * @param config - validated deployment limits.
 * @param fetcher - HTTP adapter; defaults to the Host's Fetch implementation.
 * @returns operations whose cancellation includes process and response-body cleanup.
 */
export function createDiscoveryIo(config: HostDiscoveryConfig, fetcher: typeof fetch = fetch): HostDiscoveryIo {
  return {
    readStatus: signal => readStatus(config, signal),
    probe: (origin, signal) => probe(config, fetcher, origin, signal),
  }
}

function readStatus(config: HostDiscoveryConfig, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(config.executable, ['status', '--json'], {
      env: { ...scrubbedParentEnv(), TAILSCALE_BE_CLI: '1' }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    })
    const chunks: Buffer[] = []
    let bytes = 0
    let failure: unknown
    const stop = (reason: unknown): void => { failure ??= reason; child.kill('SIGKILL') }
    const abort = (): void => { stop(signal.reason) }
    const timer = setTimeout(() => { stop(new Error('Tailscale status timed out')) }, config.statusTimeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error: NodeJS.ErrnoException) => {
      failure ??= error.code === 'ENOENT' ? new TailscaleUnavailable() : error
    })
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > config.maxStatusBytes) { stop(new Error('Tailscale status exceeded its byte limit')); return }
      chunks.push(chunk)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (failure !== undefined) {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- preserve arbitrary caller AbortSignal reasons
        reject(failure)
        return
      }
      if (code !== 0) { reject(new Error('Tailscale status failed')); return }
      let value: unknown
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch (error) { reject(new Error('Invalid Tailscale status JSON', { cause: error })); return }
      resolve(value)
    })
  })
}

async function probe(config: HostDiscoveryConfig, fetcher: typeof fetch, origin: TailnetOrigin, parent: AbortSignal): Promise<unknown> {
  parent.throwIfAborted()
  const controller = new AbortController()
  const abort = (): void => { controller.abort(parent.reason) }
  parent.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { controller.abort(new Error('Advertisement timed out')) }, config.probeTimeoutMs)
  // proxy-exempt: numeric Tailscale probes must stay on the physical Host's tailnet.
  const dispatcher = new Agent()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetcher(`${origin}${HOST_ADVERTISEMENT_PATH}`, {
      // proxy-exempt: use this probe's owned direct transport, without ambient proxy credentials.
      method: 'GET', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' }, signal: controller.signal, dispatcher,
    } as RequestInit & { dispatcher: Agent })
    reader = response.body?.getReader()
    controller.signal.throwIfAborted()
    if (!response.ok || reader === undefined) throw new Error('Advertisement unavailable')
    const chunks: Uint8Array[] = []
    let bytes = 0
    for (;;) {
      const chunk = await reader.read()
      controller.signal.throwIfAborted()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > config.maxAdvertisementBytes) throw new Error('Advertisement exceeded its byte limit')
      chunks.push(chunk.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', abort)
    if (reader !== undefined) {
      try { await reader.cancel() }
      catch { /* Fetch may already have cancelled its body on abort or a network failure. */ }
      reader.releaseLock()
    }
    await dispatcher.destroy()
  }
}
