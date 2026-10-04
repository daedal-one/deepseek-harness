/** Immutable artifact asset resources scoped by Workspace and exact revision. @module */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ArtifactContent, ArtifactId, ArtifactRevisionId } from '@deepseek-ai/dsh-artifact/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    artifact: ArtifactContent
  }
}
/**
 * Address one retained asset without a Session filesystem path.
 * @param workspaceId - authoritative Workspace identity.
 * @param artifactId - immutable artifact identity.
 * @param revisionId - pinned revision identity.
 * @param name - logical published asset name.
 * @returns the canonical resource address.
 */
export function artifactAddress(
  workspaceId: WorkspaceId,
  artifactId: ArtifactId,
  revisionId: ArtifactRevisionId,
  name: string,
): string {
  return (
    'dsh-resource://artifact/' +
    [workspaceId, artifactId, revisionId, name].map(value => encodeURIComponent(value)).join('/')
  )
}
/**
 * Register exact revision reads with Resource-owned cancellation and retained-byte admission.
 * @param ctx - authenticated Remote and root Resource services.
 * @returns the protocol registration disposer.
 */
export function registerArtifactResources(ctx: Context): () => void {
  return ctx.resources.register({
    protocol: 'artifact',
    async *open(address, { signal }) {
      try {
        const parts = address
          .slice('dsh-resource://artifact/'.length)
          .split('/')
          .map(value => decodeURIComponent(value))
        const [workspaceId, artifactId, revisionId, name] = parts
        if (
          parts.length !== 4 ||
          workspaceId === undefined ||
          artifactId === undefined ||
          revisionId === undefined ||
          name === undefined ||
          parts.some(value => value.length === 0) ||
          address !==
            artifactAddress(
              workspaceId as WorkspaceId,
              artifactId as ArtifactId,
              revisionId as ArtifactRevisionId,
              name,
            )
        )
          throw new Error('Invalid artifact resource address.')
        signal.throwIfAborted()
        const policy = await ctx.remote.artifacts.policy()
        if (!policy.ok) {
          yield policy
          return
        }
        const result = await ctx.remote.artifacts.read(
          workspaceId as WorkspaceId,
          artifactId as ArtifactId,
          revisionId as ArtifactRevisionId,
          name,
          signal,
        )
        signal.throwIfAborted()
        if (
          result.ok &&
          new TextEncoder().encode(JSON.stringify(result.value)).byteLength * 2 +
            result.value.asset.file.bytes * 2 >
            policy.value.maxRetainedBytes
        )
          throw new Error('Artifact resource exceeds the viewer memory limit.')
        yield result
      } catch (error) {
        // Cancellation ends this Resource stream; Remote and admission failures remain visible frames.
        if (!signal.aborted)
          yield {
            ok: false,
            error: new RemoteError(
              'gateway/bad-request',
              error instanceof Error ? error.message : String(error),
              {},
            ),
          }
      }
    },
  })
}
/**
 * Hold a Resource until its exact immutable bytes or failure arrive.
 * @param ctx - root Resource service.
 * @param address - canonical artifact asset address.
 * @param signal - caller lifetime and replacement cancellation.
 * @returns verified retained content from the authenticated provider.
 */
export function readArtifactResource(
  ctx: Context,
  address: string,
  signal: AbortSignal,
): Promise<ArtifactContent> {
  signal.throwIfAborted()
  const source = ctx.resources.source(address)
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      const value = source.getSnapshot()
      if (!signal.aborted && value.status !== 'live' && value.status !== 'failed' && value.status !== 'none')
        return
      signal.removeEventListener('abort', finish)
      unsubscribe()
      if (signal.aborted)
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Artifact read aborted.', 'AbortError'),
        )
      else if (value.status === 'live') resolve(value.value as ArtifactContent)
      else reject(new Error(value.failure?.message ?? 'Artifact resource provider is unavailable.'))
    }
    // Resource sources may notify synchronously while subscribing; defer observation until its disposer exists.
    const unsubscribe = source.subscribe(() => {
      queueMicrotask(finish)
    })
    signal.addEventListener('abort', finish, { once: true })
    queueMicrotask(finish)
  })
}
