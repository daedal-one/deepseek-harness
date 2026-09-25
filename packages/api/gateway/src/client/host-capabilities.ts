/** Validated capability snapshots for an already authenticated Host activation. */
import type { ClientConnectionRpc, ConnectionRpcResult, ConnectionIdentity, ConnectionHostId } from '@deepseek-ai/dsh-client-connection/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { HOST_CAPABILITIES_ENDPOINT, hostCapabilitiesSchema, type HostCapabilities } from '../capabilities-protocol.ts'

/**
 * Read advisory Host dispatch facts without retries or implicit generation recovery.
 * @param rpc - authenticated carrier for the selected Host.
 * @param expectedIdentity - validated event-stream identity; both Host and activation must match.
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

/** One Client-owned requirement selected from its generated Remote descriptors. */
export interface RemoteCapabilityRequirement {
  readonly endpoint: string
  readonly mode: 'unary' | 'stream'
  readonly wireFingerprint: string
  readonly semanticRevision: number
}

/** Paired identity and explicit requirements fixed for a native Client composition. */
export interface RemoteClientAdmission {
  readonly expectedHostId: ConnectionHostId
  /** An empty list admits a metadata-only composition. */
  readonly requiredCapabilities: readonly RemoteCapabilityRequirement[]
}

/**
 * Require matching endpoint evidence before accepting a native generation.
 * @param rpc - authenticated carrier for this generation.
 * @param identity - identity validated on this generation's event-stream opening.
 * @param requirements - Client-generated requirements independent of Host metadata.
 * @param signal - generation lifetime; cancelled reads cannot return accepted facts.
 * @returns the full validated snapshot, including optional endpoint availability.
 */
export async function admitHostCapabilities(
  rpc: ClientConnectionRpc,
  identity: ConnectionIdentity,
  requirements: readonly RemoteCapabilityRequirement[],
  signal: AbortSignal,
): Promise<HostCapabilities> {
  const result = await readHostCapabilities(rpc, identity, signal)
  if (!result.ok) {
    // A Host can return a failure code outside this Client's declaration merges.
    throw new RemoteError(result.error.code as never, result.error.message, result.error.details as never)
  }
  const endpoints = new Map(result.value.capabilities.map(capability => [capability.endpoint, capability]))
  for (const requirement of requirements) {
    const capability = endpoints.get(requirement.endpoint)
    if (capability === undefined || capability.availability === 'unavailable'
      || capability.mode !== requirement.mode || capability.wireFingerprint !== requirement.wireFingerprint
      || capability.semanticRevision !== requirement.semanticRevision) {
      throw new RemoteError('gateway/api-incompatible',
        `Required Remote ${requirement.endpoint} is unavailable or incompatible`, { endpoint: requirement.endpoint })
    }
  }
  return result.value
}
