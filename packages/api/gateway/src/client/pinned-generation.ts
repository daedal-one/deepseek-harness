/** Lifetime of one generated native operation on its paired Host generation. */
import type { ConnectionHandle, ConnectionHostId, ConnectionIdentity } from '@deepseek-ai/dsh-client-connection/client'
import { combineRemoteCancellation } from './cancellation.ts'

/** Cancellation and late-result checks for one accepted generation. */
export interface PinnedGeneration {
  readonly signal: AbortSignal
  readonly identity: ConnectionIdentity
  /** Refuse a result from a generation that ended while the operation was active. */
  assertCurrent(): void
  /** Release the generation observer and combined cancellation listeners. */
  dispose(): void
}

/**
 * Require the paired Host before dispatch and cancel when that generation ends.
 * @param connection - per-Host generation source and RPC carrier.
 * @param expectedHostId - paired identity; omitted by origin-authenticated Web compositions.
 * @param signal - caller and Remote method lifetime.
 * @param createController - platform cancellation factory.
 * @returns a scoped generation binding, or undefined for an unpinned composition.
 */
export function bindPinnedGeneration(
  connection: ConnectionHandle,
  expectedHostId: ConnectionHostId | undefined,
  signal: AbortSignal,
  createController: () => AbortController,
): PinnedGeneration | undefined {
  if (expectedHostId === undefined) return undefined
  const accepted = connection.generation.getSnapshot()
  if (accepted?.host.identity?.hostId !== expectedHostId) {
    throw new Error('client api: the paired Host has no ready connection generation')
  }
  const lifetime = createController()
  const cancellation = combineRemoteCancellation([signal, lifetime.signal], createController)
  const changed = new Error('client api: the Host connection generation ended; operation outcome may be uncertain')
  const stop = connection.generation.subscribe(() => {
    if (connection.generation.getSnapshot() !== accepted) lifetime.abort(changed)
  })
  return {
    signal: cancellation.signal,
    identity: accepted.host.identity,
    assertCurrent() {
      if (connection.generation.getSnapshot() !== accepted) throw changed
    },
    dispose() { stop(); cancellation.dispose() },
  }
}
