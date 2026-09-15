/** Validated capability snapshots for an already authenticated Host activation. */
import type { ClientConnectionRpc, ConnectionRpcResult, ConnectionIdentity } from '@deepseek-ai/dsh-client-connection/client'
import { HOST_CAPABILITIES_ENDPOINT, hostCapabilitiesSchema, type HostCapabilities } from '../capabilities-protocol.ts'

/**
 * Read advisory Host dispatch facts without retries or implicit generation recovery.
 * @param rpc - authenticated carrier for the selected Host.
 * @param expectedIdentity - admitted identity; both Host and activation must match.
 * @param signal - caller-owned lifetime, cancelled when its generation ends.
 * @returns validated facts or a failure; carrier rejection and cancellation propagate.
 */
export async function readHostCapabilities(
  rpc: ClientConnectionRpc,
  expectedIdentity: ConnectionIdentity,
  signal?: AbortSignal,
): Promise<ConnectionRpcResult<HostCapabilities>> {
  signal?.throwIfAborted()
  const result = await rpc.call('/api', HOST_CAPABILITIES_ENDPOINT, {}, signal)
  signal?.throwIfAborted()
  if (!result.ok) return result
  const parsed = hostCapabilitiesSchema.safeParse(result.value)
  if (!parsed.success) {
    return { ok: false, error: {
      code: 'gateway/invalid-capabilities', message: 'Invalid Host capability response', details: {},
    } }
  }
  if (parsed.data.identity.hostId !== expectedIdentity.hostId
    || parsed.data.identity.activationId !== expectedIdentity.activationId) {
    return { ok: false, error: {
      code: 'gateway/capability-identity-mismatch', message: 'Host capability response identifies another activation', details: {},
    } }
  }
  return { ok: true, value: parsed.data }
}
