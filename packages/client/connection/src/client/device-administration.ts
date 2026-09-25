/** Browser-owner device administration bound to one page and Connection generation. */
import { z } from 'zod'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConnectionGeneration, ConnectionHostInfo } from './connection.ts'
import type { ConnectionGenerationState } from './handle.ts'
import type { RpcFetch } from './rpc-caller.ts'
import { connectionHostIdSchema, type ConnectionHostId } from '../host-identity-protocol.ts'
import {
  DEVICE_ACCESS_PATHS, connectionDeviceEnrollmentSchema, connectionDeviceInfoSchema,
  type ConnectionDeviceId, type ConnectionDeviceInfo, type ConnectionDeviceEnrollment,
} from '../device-protocol.ts'

/** Fixed presentation diagnostics; wire messages and request bodies never enter this state. */
export type DeviceAdministrationError = 'owner-required' | 'unavailable' | 'read-failed' | 'enrollment-unknown'
  | 'revocation-unknown' | 'invalid-response' | 'enrollment-limit' | 'expired'
/** A browser-owned snapshot; the enrollment exists only while its visible section owns it. */
export interface DeviceAdministrationSnapshot {
  status: 'unavailable' | 'disconnected' | 'idle' | 'ready' | 'error'
  origin: string | null
  hostId: ConnectionHostId | null
  devices: ConnectionDeviceInfo[]
  enrollment: ConnectionDeviceEnrollment | null
  busy: 'list' | 'enroll' | 'revoke' | null
  error: DeviceAdministrationError | null
}
/** Browser administration operations; only the Host can authorize an owner request. */
export interface DeviceAdministrationService {
  readonly state: ObservableSnapshot<DeviceAdministrationSnapshot>
  /** Open the section and read its current device list. */
  open(): void
  /** Close the section, cancel its requests and erase enrollment material. */
  close(): void
  /**
   * Refresh authoritative metadata without retrying a mutation.
   * @returns after the read settles.
   */
  refresh(): Promise<void>
  /**
   * Create one short-lived challenge after an explicit gesture.
   * @returns after that attempt settles.
   */
  enroll(): Promise<void>
  /** Hide a QR and discard a pending creation; the Host challenge still expires on its own. */
  hideEnrollment(): void
  /**
   * Revoke one confirmed device without retry.
   * @param deviceId - currently listed device.
   * @returns after the attempt settles.
   */
  revoke(deviceId: ConnectionDeviceId): Promise<void>
}
/** Browser inputs kept separate from native bearer and private shell transports. */
export interface DeviceAdministrationOptions {
  readonly origin: string | undefined
  readonly fetch: RpcFetch
  readonly generation: ConnectionGenerationState
}
const listedSchema = z.object({ version: z.literal(1), hostId: connectionHostIdSchema,
  devices: z.array(connectionDeviceInfoSchema).refine(devices => new Set(devices.map(device => device.deviceId)).size === devices.length),
}).strict()
const revokedSchema = z.object({ revoked: z.boolean() }).strict()
const failureSchema = z.object({ ok: z.literal(false), error: z.object({ code: z.string(),
  message: z.string(), details: z.record(z.string(), z.unknown()),
}).strict() }).strict()
class Refusal extends Error {
  readonly code: DeviceAdministrationError
  constructor(code: DeviceAdministrationError) { super(code); this.code = code }
}

/** React-free owner of browser requests, metadata and transient QR material. */
export class BrowserDeviceAdministration implements DeviceAdministrationService {
  private readonly store = createSnapshotStore<DeviceAdministrationSnapshot>({
    status: 'unavailable', origin: null, hostId: null, devices: [], enrollment: null, busy: null, error: null,
  })
  /** Read-only source consumed through the renderer's injected hook binding. */
  readonly state: ObservableSnapshot<DeviceAdministrationSnapshot> = this.store
  private visible = false
  private disposed = false
  private closing: Promise<void> | undefined
  private revision = 0
  private controller: AbortController | undefined
  private expiry: ReturnType<typeof setTimeout> | undefined
  private stopFollowing: (() => void) | undefined
  private readonly inFlight = new Set<Promise<void>>()

  /** @param options - explicit same-page browser transport and live generation source. */
  constructor(private readonly options: DeviceAdministrationOptions) {
    if (options.origin !== undefined) {
      const url = new URL(options.origin)
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== options.origin)
        throw new TypeError('Device administration requires a complete HTTP(S) origin')
    }
    this.reset()
  }

  /** Subscribe once; opening the Settings section owns all network reads. */
  start(): void {
    if (this.disposed) return
    this.stopFollowing ??= this.options.generation.subscribe(() => {
      this.cancel()
      this.reset()
      if (this.visible) void this.refresh()
    })
  }

  /** Open the section and load owner metadata; repeated mounts do not duplicate pending work. */
  open(): void {
    if (this.disposed) return
    this.visible = true
    void this.refresh()
  }

  /** Cancel this section's work and remove all retained metadata and enrollment material. */
  close(): void {
    this.visible = false
    this.cancel()
    this.reset()
  }

  /**
   * Read once through the active generation.
   * @returns after that attempt settles.
   */
  refresh(): Promise<void> {
    return this.perform('list', 'read-failed', async (signal, host) => {
      const value = await this.request(DEVICE_ACCESS_PATHS.list, undefined, listedSchema, signal)
      if (value.hostId !== host.identity?.hostId) throw new Refusal('invalid-response')
      return { status: 'ready', devices: value.devices }
    })
  }

  /**
   * Mint one QR challenge; a failed or lost result is never retried.
   * @returns after the attempt settles.
   */
  enroll(): Promise<void> {
    if (this.store.getSnapshot().status !== 'ready') return Promise.resolve()
    return this.perform('enroll', 'enrollment-unknown', async (signal, host) => {
      const enrollment = await this.request(DEVICE_ACCESS_PATHS.enroll, {}, connectionDeviceEnrollmentSchema, signal)
      if (enrollment.hostId !== host.identity?.hostId) throw new Refusal('invalid-response')
      if (enrollment.expiresAt <= Date.now()) throw new Refusal('expired')
      return { enrollment }
    })
  }

  /** Remove QR material without claiming to cancel its still-valid Host challenge. */
  hideEnrollment(): void {
    if (this.store.getSnapshot().busy === 'enroll') this.cancel()
    this.clearExpiry()
    this.store.update((state) => { state.enrollment = null })
  }

  /**
   * Revoke the selected current device.
   * @param deviceId - confirmed listed device.
   * @returns after the attempt settles.
   */
  revoke(deviceId: ConnectionDeviceId): Promise<void> {
    const state = this.store.getSnapshot()
    if (state.status !== 'ready' || !state.devices.some(device => device.deviceId === deviceId)) return Promise.resolve()
    return this.perform('revoke', 'revocation-unknown', async (signal) => {
      await this.request(DEVICE_ACCESS_PATHS.revoke, { deviceId }, revokedSchema, signal)
      return { devices: this.store.getSnapshot().devices.filter(device => device.deviceId !== deviceId) }
    })
  }

  /**
   * Cancel requests, release listeners and await owned work.
   * @returns after all cancelled requests settle.
   */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.disposed = true
    this.close()
    this.stopFollowing?.()
    this.stopFollowing = undefined
    this.closing = Promise.allSettled([...this.inFlight]).then(() => {})
    return this.closing
  }

  private cancel(): void {
    this.revision++
    this.controller?.abort()
    this.controller = undefined
    this.clearExpiry()
    this.store.update((state) => { state.enrollment = null; state.busy = null })
  }

  private reset(): void {
    const hostId = this.options.generation.getSnapshot()?.host.identity?.hostId ?? null
    this.store.set({ status: this.options.origin === undefined ? 'unavailable' : hostId === null ? 'disconnected' : 'idle',
      origin: this.options.origin ?? null, hostId, devices: [], enrollment: null, busy: null, error: null })
  }

  private clearExpiry(): void {
    if (this.expiry !== undefined) clearTimeout(this.expiry)
    this.expiry = undefined
  }

  private expire(): void {
    this.clearExpiry()
    const enrollment = this.store.getSnapshot().enrollment
    if (enrollment === null) return
    const remaining = enrollment.expiresAt - Date.now()
    if (remaining <= 0) {
      this.store.update((state) => { state.enrollment = null; state.error = 'expired' })
      return
    }
    // Browser timers use signed 32-bit delays; recheck a larger or clock-shifted expiry.
    this.expiry = setTimeout(() => { this.expire() }, Math.min(remaining, 2_147_483_647))
  }

  private perform(
    kind: NonNullable<DeviceAdministrationSnapshot['busy']>, failure: DeviceAdministrationError,
    action: (signal: AbortSignal, host: ConnectionHostInfo) => Promise<Partial<DeviceAdministrationSnapshot>>,
  ): Promise<void> {
    const generation: ConnectionGeneration | undefined = this.options.generation.getSnapshot()
    if (this.disposed || !this.visible || this.options.origin === undefined || generation?.host.identity === undefined
      || this.store.getSnapshot().busy !== null) return Promise.resolve()
    const controller = new AbortController()
    this.controller = controller
    const revision = ++this.revision
    this.clearExpiry()
    this.store.update((state) => { state.busy = kind; state.error = null; state.enrollment = null })
    const current = (): boolean => !controller.signal.aborted && revision === this.revision && !this.disposed
      && this.visible && this.options.generation.getSnapshot() === generation
    const pending = action(controller.signal, generation.host).then((patch) => {
      if (!current()) return
      this.store.update((state) => { Object.assign(state, patch) })
      this.expire()
    }).catch((error: unknown) => {
      if (!current()) return
      const code = error instanceof Refusal ? error.code : failure
      this.store.update((state) => {
        state.error = code
        state.status = code === 'unavailable' ? 'unavailable' : 'error'
      })
    }).finally(() => {
      if (current()) { this.controller = undefined; this.store.update((state) => { state.busy = null }) }
      this.inFlight.delete(pending)
    })
    this.inFlight.add(pending)
    return pending
  }

  private async request<T>(path: string, body: object | undefined, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    const response = await this.options.fetch(new URL(path, this.options.origin), {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, signal,
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    })
    signal.throwIfAborted()
    if (response.status === 404) throw new Refusal('unavailable')
    if (response.status === 401 || response.status === 403) throw new Refusal('owner-required')
    const value: unknown = await response.json()
    signal.throwIfAborted()
    const result = z.union([z.object({ ok: z.literal(true), value: schema }).strict(), failureSchema]).safeParse(value)
    if (!result.success || result.data.ok !== response.ok) throw new Refusal('invalid-response')
    if (!result.data.ok) throw new Refusal(result.data.error.code === 'connection/enrollment-limit' ? 'enrollment-limit' : 'invalid-response')
    return result.data.value
  }
}
