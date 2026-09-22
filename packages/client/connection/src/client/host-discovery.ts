/** Optional discovery reads through an already authenticated assisting Host. */
import { API_PATH } from '../api-path.ts'
import type { ConnectionHostId } from '../host-identity-protocol.ts'
import { HOST_DISCOVERY_ENDPOINT, hostDiscoveryResultSchema, type HostDiscoveryResult } from '../discovery-protocol.ts'
import type { ClientConnectionRpc, ConnectionRpcResult } from '../rpc.ts'

/**
 * Discover candidate metadata without retrying, enrolling, or transferring credentials.
 * @param rpc - authenticated transport to one assisting Host.
 * @param expectedHostId - paired assisting Host whose response is acceptable.
 * @param signal - caller lifetime forwarded to the transport.
 * @returns validated metadata or a fixed failure; unavailable endpoints remain optional.
 */
export async function discoverHosts(rpc: ClientConnectionRpc, expectedHostId: ConnectionHostId, signal?: AbortSignal)
  : Promise<ConnectionRpcResult<HostDiscoveryResult>> {
  const checkCancelled = (): void => { if (signal?.aborted === true) throw signal.reason }
  checkCancelled()
  const result = await rpc.call(API_PATH, HOST_DISCOVERY_ENDPOINT, {}, signal)
  checkCancelled()
  if (!result.ok) return result
  const parsed = hostDiscoveryResultSchema.safeParse(result.value)
  if (!parsed.success || parsed.data.host.hostId !== expectedHostId) {
    return { ok: false, error: {
      code: 'connection/invalid-discovery', message: 'Invalid Host discovery response', details: {},
    } }
  }
  return { ok: true, value: parsed.data }
}
