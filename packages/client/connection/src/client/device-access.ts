/** Portable enrollment claim against one explicitly selected Host origin. */
import { z } from 'zod'
import type { ConnectionRpcResult } from '../rpc.ts'
import type { RpcFetch } from './rpc-caller.ts'
import type { ConnectionHostId } from '../host-identity-protocol.ts'
import { DEVICE_ACCESS_PATHS, connectionDeviceGrantSchema, type ConnectionDeviceGrant } from '../device-protocol.ts'

/** Platform inputs for a single enrollment claim; no ambient device credential is used. */
export interface DeviceEnrollmentClaimOptions {
  readonly baseUrl: string
  readonly expectedHostId: ConnectionHostId
  readonly challenge: string
  readonly label: string
  /** Dedicated unauthenticated fetch; must not add another Host's credentials. */
  readonly fetch: RpcFetch
  readonly signal: AbortSignal
}
const claimResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: connectionDeviceGrantSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({
    code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()),
  }).strict() }).strict(),
])

/**
 * Claim once without redirects, ambient cookies or automatic retry.
 * @param options - selected Host, QR challenge and platform-owned cancellation and transport.
 * @returns validated credential or a failure; cancellation and carrier rejection propagate.
 */
export async function claimDeviceEnrollment(options: DeviceEnrollmentClaimOptions): Promise<ConnectionRpcResult<ConnectionDeviceGrant>> {
  options.signal.throwIfAborted()
  const url = new URL(DEVICE_ACCESS_PATHS.claim, options.baseUrl)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    throw new TypeError('Device enrollment requires an HTTP(S) origin without URL credentials')
  }
  const response = await options.fetch(url, { method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'content-type': 'application/json' }, signal: options.signal,
    body: JSON.stringify({ hostId: options.expectedHostId, challenge: options.challenge, label: options.label }),
  })
  const parsed = claimResultSchema.safeParse(await response.json())
  options.signal.throwIfAborted()
  if (!parsed.success || parsed.data.ok !== response.ok) {
    return { ok: false, error: { code: 'connection/invalid-enrollment-response', message: 'Invalid device enrollment response', details: {} } }
  }
  if (parsed.data.ok && parsed.data.value.hostId !== options.expectedHostId) {
    return { ok: false, error: { code: 'connection/enrollment-host-mismatch', message: 'Device grant belongs to another Host', details: {} } }
  }
  return parsed.data
}
