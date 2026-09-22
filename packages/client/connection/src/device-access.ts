/** Connection-owned enrollment, durable device grants and revocation lifetimes. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { storedHostIdentitySchema, type ConnectionIdentity, type ConnectionHostId } from './host-identity-protocol.ts'
import { connectionDeviceIdSchema, connectionDeviceInfoSchema, deviceCredentialSchema,
  type ConnectionDeviceEnrollment, type ConnectionDeviceGrant,
  type ConnectionDeviceId, type ConnectionDeviceInfo } from './device-protocol.ts'
import type { ConnectionRequestLease } from './rpc.ts'

/** Independent credential record owned by Connection; browser signing and Host identity are separate. */
export const DEVICE_ACCESS_KEY = credentialKey('client-connection', 'device-access')

/** Explicit deployment limits; omission of the whole configuration disables device access. */
export interface DeviceAccessConfig {
  /** Elapsed lifetime of a single-use enrollment challenge in milliseconds. */
  readonly enrollmentTtlMs: number
  /** Maximum simultaneously outstanding, unexpired challenges. */
  readonly maxPendingEnrollments: number
  /** Maximum durable device grants owned by this Host. */
  readonly maxDevices: number
}
/** One shared configuration validator for Loader and direct Host compositions. */
export const DeviceAccessConfigSchema: schema<DeviceAccessConfig> = schema.object({
  enrollmentTtlMs: schema.natural().min(1).max(2_147_483_647).required(),
  maxPendingEnrollments: schema.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxDevices: schema.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const storedDeviceSchema = z.object({ info: connectionDeviceInfoSchema, digest: digestSchema }).strict()
const storedDevicesSchema = z.object({
  version: z.literal(1), hostId: storedHostIdentitySchema.shape.hostId,
  devices: z.array(storedDeviceSchema).refine(devices => new Set(devices.map(device => device.info.deviceId)).size === devices.length),
}).strict()
type StoredDevices = z.infer<typeof storedDevicesSchema>
interface PendingEnrollment { readonly deadline: number }
interface ActiveDevice { readonly deviceId: ConnectionDeviceId; readonly digest: string; readonly controller: AbortController }

/** Stable, non-secret failure returned by the device routes. */
export class DeviceAccessError extends Error {
  /**
   * @param status - HTTP status of the failed operation.
   * @param code - stable failure category without enrollment or credential values.
   */
  constructor(readonly status: 400 | 401 | 409 | 500, readonly code: string) {
    super(code)
  }
}

/** Hash a minted token without retaining the bearer value in durable state. */
function digest(token: string): string { return createHash('sha256').update(token).digest('hex') }

/** One Connection activation's challenges, serialized admissions and active grant leases. */
export class DeviceAccess {
  private readonly challenges = new Map<string, PendingEnrollment>()
  private readonly active = new Set<ActiveDevice>()
  private pending: Promise<void> = Promise.resolve()
  private closed = false

  private constructor(
    private readonly credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>,
    private readonly identity: ConnectionIdentity,
    private readonly config: DeviceAccessConfig,
  ) {}

  /**
   * Validate deployment limits and existing grants before publishing device access.
   * @param credentials - credential owner serializing durable writes.
   * @param identity - current Host identity; foreign records are refused.
   * @param config - explicit challenge lifetime and count limits.
   * @returns a ready owner; malformed persisted state prevents activation.
   */
  static async create(
    credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>,
    identity: ConnectionIdentity,
    config: DeviceAccessConfig,
  ): Promise<DeviceAccess> {
    const access = new DeviceAccess(credentials, identity, DeviceAccessConfigSchema(config))
    await access.refresh()
    return access
  }

  /**
   * Issue an owner-authorized enrollment challenge within the configured capacity.
   * @returns a fresh single-use challenge after expiring old pending entries.
   */
  enroll(): Promise<ConnectionDeviceEnrollment> {
    return this.enqueue(() => {
      const now = performance.now()
      for (const [key, value] of this.challenges) if (value.deadline <= now) this.challenges.delete(key)
      if (this.challenges.size >= this.config.maxPendingEnrollments) throw new DeviceAccessError(409, 'connection/enrollment-limit')
      const challenge = randomBytes(32).toString('base64url')
      this.challenges.set(digest(challenge), { deadline: now + this.config.enrollmentTtlMs })
      return { version: 1, hostId: this.identity.hostId, challenge, expiresAt: Date.now() + this.config.enrollmentTtlMs }
    })
  }

  /**
   * Consume a challenge before committing a new independently revocable grant.
   * @param request - validated claim body with expected Host identity and device label.
   * @returns the persisted device metadata and its bearer credential, exactly once.
   */
  claim(request: { readonly hostId: ConnectionHostId; readonly challenge: string; readonly label: string })
    : Promise<ConnectionDeviceGrant> {
    return this.enqueue(async () => {
      const key = digest(request.challenge)
      const enrollment = this.challenges.get(key)
      if (request.hostId !== this.identity.hostId || enrollment === undefined) {
        throw new DeviceAccessError(401, 'connection/invalid-enrollment')
      }
      this.challenges.delete(key)
      if (enrollment.deadline <= performance.now()) throw new DeviceAccessError(401, 'connection/invalid-enrollment')
      const info: ConnectionDeviceInfo = {
        deviceId: connectionDeviceIdSchema.parse(randomUUID()), label: request.label, createdAt: Date.now(),
      }
      const credential = deviceCredentialSchema.parse(`dsh-device-v1.${info.deviceId}.${randomBytes(32).toString('base64url')}`)
      const created = { info, digest: digest(credential) }
      const record = await this.credentials.modifyRecord(DEVICE_ACCESS_KEY, (current) => {
        const stored = this.read(current)
        if (stored.devices.length >= this.config.maxDevices) throw new DeviceAccessError(409, 'connection/device-limit')
        return Promise.resolve({ kind: 'grant', payload: { ...stored, devices: [...stored.devices, created] } })
      })
      const stored = this.read(record)
      if (!stored.devices.some(device => device.info.deviceId === info.deviceId && device.digest === created.digest)) {
        throw new DeviceAccessError(500, 'connection/device-write-failed')
      }
      this.reconcile(stored)
      this.assertOpen()
      return { version: 1, hostId: this.identity.hostId, device: info, credential }
    })
  }

  /**
   * Read the current durable grants without exposing credential digests.
   * @returns only public device metadata.
   */
  list(): Promise<readonly ConnectionDeviceInfo[]> {
    return this.enqueue(async () => (await this.load()).devices.map(device => device.info))
  }

  /**
   * Revoke one grant durably before cancelling its active request leases.
   * @param deviceId - validated identity of the grant to remove.
   * @returns whether a stored grant was removed; repeated revocation is a no-op.
   */
  revoke(deviceId: ConnectionDeviceId): Promise<boolean> {
    return this.enqueue(async () => {
      let revoked = false
      const record = await this.credentials.modifyRecord(DEVICE_ACCESS_KEY, (current) => {
        const stored = this.read(current)
        revoked = stored.devices.some(device => device.info.deviceId === deviceId)
        return Promise.resolve(revoked
          ? { kind: 'grant', payload: { ...stored, devices: stored.devices.filter(device => device.info.deviceId !== deviceId) } }
          : undefined)
      })
      const stored = this.read(record)
      if (stored.devices.some(device => device.info.deviceId === deviceId)) {
        throw new DeviceAccessError(500, 'connection/device-write-failed')
      }
      this.reconcile(stored)
      return revoked
    })
  }

  /**
   * Authenticate a bearer and retain a revocation lifetime for its carrier.
   * @param credential - exact bearer value, never a URL or cookie value.
   * @returns a caller-owned lease, or undefined when the credential is invalid or revoked.
   */
  authorize(credential: string): Promise<ConnectionRequestLease | undefined> {
    const parsed = deviceCredentialSchema.safeParse(credential)
    if (!parsed.success) return Promise.resolve(undefined)
    return this.enqueue(async () => {
      const stored = await this.load()
      const device = stored.devices.find(candidate => candidate.info.deviceId === parsed.data.split('.')[1])
      const actual = digest(parsed.data)
      if (device === undefined || !timingSafeEqual(Buffer.from(device.digest, 'hex'), Buffer.from(actual, 'hex'))) return undefined
      this.assertOpen()
      const active = { deviceId: device.info.deviceId, digest: actual, controller: new AbortController() }
      this.active.add(active)
      return { signal: active.controller.signal, dispose: () => { this.active.delete(active) } }
    })
  }

  /** Reconcile observed credential-record edits with active grants; disposed owners ignore notifications. */
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve()
    return this.enqueue(async () => { await this.load() })
  }

  /** Stop admission, invalidate challenges and leases, and await queued credential work. */
  async dispose(): Promise<void> {
    this.closed = true
    this.challenges.clear()
    this.cancelAll()
    await this.pending
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.pending.then(() => { this.assertOpen(); return operation() })
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }

  private assertOpen(): void {
    if (this.closed) throw new DeviceAccessError(401, 'connection/device-access-closed')
  }

  private async load(): Promise<StoredDevices> {
    try {
      const stored = this.read(await this.credentials.readRecord(DEVICE_ACCESS_KEY))
      this.reconcile(stored)
      return stored
    } catch (error) {
      this.cancelAll()
      throw error
    }
  }

  private read(record: CredentialRecord | undefined): StoredDevices {
    if (record === undefined) return { version: 1, hostId: this.identity.hostId, devices: [] }
    const parsed = storedDevicesSchema.safeParse(record.kind === 'grant' ? record.payload : undefined)
    if (!parsed.success || parsed.data.hostId !== this.identity.hostId) {
      this.cancelAll()
      throw new DeviceAccessError(500, 'connection/invalid-device-record')
    }
    return parsed.data
  }

  private reconcile(stored: StoredDevices): void {
    for (const active of this.active) {
      if (!stored.devices.some(device => device.info.deviceId === active.deviceId && device.digest === active.digest)) {
        active.controller.abort(new Error('Device authorization revoked'))
        this.active.delete(active)
      }
    }
  }

  private cancelAll(): void {
    for (const active of this.active) active.controller.abort(new Error('Device authorization unavailable'))
    this.active.clear()
  }
}
