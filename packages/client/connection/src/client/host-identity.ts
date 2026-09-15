/** Validated Host identity reads over an already authenticated RPC carrier. */
import { API_PATH } from '../api-path.ts'
import { CONNECTION_IDENTITY_ENDPOINT, connectionIdentitySchema, type ConnectionIdentity } from '../host-identity-protocol.ts'
import type { ClientConnectionRpc, ConnectionRpcResult } from '../rpc.ts'

/**
 * Read correlation facts without retrying or treating them as authorization.
 * @param rpc - authenticated carrier for the selected Host.
 * @param signal - caller lifetime forwarded to the transport.
 * @returns validated identity or the Host failure; transport rejection propagates.
 */
export async function readHostIdentity(
  rpc: ClientConnectionRpc,
  signal?: AbortSignal,
): Promise<ConnectionRpcResult<ConnectionIdentity>> {
  const result = await rpc.call(API_PATH, CONNECTION_IDENTITY_ENDPOINT, {}, signal)
  if (!result.ok) return result
  const parsed = connectionIdentitySchema.safeParse(result.value)
  if (!parsed.success) {
    return { ok: false, error: {
      code: 'connection/invalid-identity', message: 'Invalid Host identity response', details: {},
    } }
  }
  return { ok: true, value: parsed.data }
}
