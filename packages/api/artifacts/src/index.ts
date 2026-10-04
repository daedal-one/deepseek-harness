/** Authenticated Workspace artifact Remote consumer and bounded independent preview leases. @module */
import z from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {
  ArtifactPending,
  ArtifactContent,
  ArtifactId,
  ArtifactOperationId,
  ArtifactPage,
  ArtifactPublish,
  ArtifactRevision,
  ArtifactRevisionId,
} from '@deepseek-ai/dsh-artifact/types'
import type {} from '@deepseek-ai/dsh-artifact'
import type {
  ArtifactFrame,
  ArtifactInvocation,
  ArtifactInvocationId,
  ArtifactRuntimeInteraction,
} from '@deepseek-ai/dsh-artifact-runtime/types'
import type {} from '@deepseek-ai/dsh-artifact-runtime'
/** Trusted editor and selected-text admission limits. */
export interface Config {
  /** Maximum simultaneous catalogue invalidation streams. */
  maxCatalogueWatchers: number
  /** Maximum retained viewer bytes, including decoded text and preview pixels. */
  maxRetainedBytes: number
  /** Maximum replacement UTF-8 text bytes in a trusted edit. */
  maxEditBytes: number
  /** Maximum logged agent edit request bytes, including its envelope. */
  maxSelectionBytes: number
}
/** Positive deployment bounds for trusted controls. */
export const Config: z<Config> = z.object({
  maxCatalogueWatchers: z.number().step(1).min(1).required(),
  maxRetainedBytes: z.number().step(1).min(1).required(),
  maxEditBytes: z.number().step(1).min(1).required(),
  maxSelectionBytes: z.number().step(1).min(1).required(),
})
import type { ArtifactPolicy } from './types.ts'
export type { ArtifactPolicy } from './types.ts'
interface PreviewLease {
  workspaceId: WorkspaceId
  artifactId: ArtifactId
  revisionId: ArtifactRevisionId
  invocation: ArtifactInvocation
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    artifactsController: ArtifactsController
  }
}
/** Every Remote is behind the authenticated gateway; Workspace ownership is checked in the executor. */
export class ArtifactsController extends TypertRemoteService {
  static Config = Config
  static inject = ['typert', 'artifacts', 'sessions', 'workspaceRegistry']
  private watchers = 0
  private readonly lifetime = new AbortController()
  private readonly allocations = new Set<Promise<ArtifactInvocation>>()
  private readonly previews = new Map<ArtifactInvocationId, PreviewLease>()
  /**
   * @param ctx - authoritative artifact provider and authenticated Remote registry.
   */
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'artifactsController', { namespace: 'artifacts' })
    ctx.on('domain/changed', (change) => {
      if (change.domain !== 'workspace' || change.table !== 'workspaces' || change.operation !== 'deleted')
        return
      const revoked = [...this.previews.values()].filter(lease => lease.workspaceId === change.key)
      void Promise.all(
        revoked.map(async (lease) => {
          await lease.invocation.close()
          this.previews.delete(lease.invocation.id)
        }),
      ).catch((error: unknown) => {
        // Failed removals retain their lease for disposal retry; the revoked Workspace cannot interact.
        ctx.logger.error('Artifact preview revocation failed: %s', error)
      })
    })
    ctx.effect(
      () => async () => {
        this.lifetime.abort()
        await Promise.allSettled(this.allocations)
        await Promise.all([...this.previews.values()].map(lease => lease.invocation.close()))
        this.previews.clear()
      },
      'artifacts.apiClose',
    )
  }
  /**
   * Read execution availability and trusted editing bounds.
   * @returns capability availability and authoritative trusted-text limits.
   */
  @Remote
  policy(): ArtifactPolicy {
    return {
      previewAvailable: this.ctx.get('artifactRuntime') !== undefined,
      maxRetainedBytes: this.config.maxRetainedBytes,
      maxEditBytes: this.config.maxEditBytes,
      maxSelectionBytes: this.config.maxSelectionBytes,
    }
  }
  /**
   * Publish an exact-head replacement for one retained text asset.
   * @param session - authorized live editing Session.
   * @param workspaceId - selected Workspace.
   * @param artifactId - owned artifact.
   * @param expectedHead - exact observed revision.
   * @param name - retained text asset.
   * @param content - complete replacement text.
   * @param operationId - retry identity.
   * @returns a new immutable revision or conflict.
   */
  @Remote
  async edit(
    session: Session,
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    expectedHead: ArtifactRevisionId,
    name: string,
    content: string,
    operationId: ArtifactOperationId,
  ): Promise<ArtifactRevision> {
    if (Buffer.byteLength(content) > this.config.maxEditBytes)
      throw new Error('Artifact text edit exceeds the editor limit.')
    const first = await this.ctx.artifacts.read(workspaceId, artifactId, expectedHead, name)
    if (
      !first.asset.mediaType.startsWith('text/') &&
      first.asset.mediaType !== 'application/json' &&
      first.asset.mediaType !== 'image/svg+xml'
    )
      throw new Error('Direct editing requires a text asset.')
    const assets = []
    for (const asset of first.revision.assets)
      assets.push({
        name: asset.name,
        mediaType: asset.mediaType,
        data:
          asset.name === name
            ? Buffer.from(content).toString('base64')
            : (await this.ctx.artifacts.read(workspaceId, artifactId, expectedHead, asset.name)).data,
      })
    return this.ctx.artifacts.publish(session, {
      operationId,
      artifactId,
      expectedHead,
      title: first.revision.title,
      entry: first.revision.entry,
      profile: first.revision.profile,
      assets,
    })
  }
  /**
   * Stream coalesced invalidations after durable catalogue changes.
   * @param workspaceId - explicitly selected Workspace.
   * @param signal - subscription cancellation.
   * @returns bounded invalidations; consumers reread an authorized catalogue page.
   */
  @Remote({ mode: 'stream' })
  async *watch(workspaceId: WorkspaceId, signal: AbortSignal): AsyncIterable<boolean> {
    const stopped = AbortSignal.any([signal, this.lifetime.signal])
    stopped.throwIfAborted()
    if (this.ctx.workspaceRegistry.get(workspaceId) === undefined)
      throw new Error('Unknown artifact Workspace.')
    if (this.watchers >= this.config.maxCatalogueWatchers)
      throw new Error('Artifact catalogue subscription limit reached.')
    this.watchers++
    let changed = false
    let wake = Promise.withResolvers<void>()
    const dispose = this.ctx.on('artifact/changed', (id) => {
      if (id !== workspaceId) return
      changed = true
      wake.resolve()
    })
    const disposeWorkspace = this.ctx.on('domain/changed', (change) => {
      if (
        change.domain === 'workspace' &&
        change.table === 'workspaces' &&
        change.operation === 'deleted' &&
        change.key === workspaceId
      ) {
        changed = true
        wake.resolve()
      }
    })
    const hasChange = (): boolean => changed
    const abort = (): void => {
      wake.resolve()
    }
    stopped.addEventListener('abort', abort, { once: true })
    try {
      yield true
      for (;;) {
        stopped.throwIfAborted()
        if (!hasChange()) await wake.promise
        stopped.throwIfAborted()
        if (this.ctx.workspaceRegistry.get(workspaceId) === undefined)
          throw new Error('Artifact Workspace was revoked.')
        changed = false
        wake = Promise.withResolvers<void>()
        yield true
      }
    } finally {
      stopped.removeEventListener('abort', abort)
      dispose()
      disposeWorkspace()
      this.watchers--
    }
  }
  /**
   * List recoverable publication reservations for the selected Workspace.
   * @param workspaceId - selected Workspace.
   * @returns bounded interrupted saves.
   */
  @Remote
  pending(workspaceId: WorkspaceId): Promise<readonly ArtifactPending[]> {
    return this.ctx.artifacts.pending(workspaceId)
  }
  /**
   * Resolve an interrupted operation against durable Session evidence.
   * @param workspaceId - selected Workspace.
   * @param revisionId - exact interrupted operation.
   * @returns recovered revision, or null after safe abandonment.
   */
  @Remote
  reconcile(workspaceId: WorkspaceId, revisionId: ArtifactRevisionId): Promise<ArtifactRevision | null> {
    return this.ctx.artifacts.reconcile(workspaceId, revisionId)
  }
  /**
   * Read committed artifact heads without activating creating Sessions.
   * @param workspaceId - explicitly selected Workspace.
   * @param after - exclusive cursor or first page.
   * @returns bounded committed heads.
   */
  @Remote
  list(workspaceId: WorkspaceId, after: ArtifactId | null): Promise<ArtifactPage> {
    return this.ctx.artifacts.list(workspaceId, after)
  }
  /**
   * Read an artifact’s immutable revision history.
   * @param workspaceId - explicitly selected Workspace.
   * @param artifactId - owned artifact.
   * @param before - exclusive revision cursor.
   * @returns bounded immutable history.
   */
  @Remote
  history(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    before: ArtifactRevisionId | null,
  ): Promise<readonly ArtifactRevision[]> {
    return this.ctx.artifacts.history(workspaceId, artifactId, before)
  }
  /**
   * Verify and return bytes belonging to an exact Workspace revision.
   * @param workspaceId - explicitly selected Workspace.
   * @param artifactId - owned artifact.
   * @param revisionId - exact revision.
   * @param name - manifest asset name.
   * @param signal - read cancellation.
   * @returns verified complete immutable bytes.
   */
  @Remote
  read(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    name: string,
    signal: AbortSignal,
  ): Promise<ArtifactContent> {
    return this.ctx.artifacts.read(workspaceId, artifactId, revisionId, name, signal)
  }
  /**
   * Persist and checkpoint one complete immutable revision.
   * @param session - authorized live editing Session resolved by the gateway.
   * @param request - complete immutable replacement.
   * @returns durable new revision or conflict.
   */
  @Remote
  publish(session: Session, request: ArtifactPublish): Promise<ArtifactRevision> {
    return this.ctx.artifacts.publish(session, request)
  }
  /**
   * Publish a retained revision as a new head with optimistic concurrency.
   * @param session - authorized live editing Session resolved by the gateway.
   * @param artifactId - owned artifact.
   * @param revisionId - restore source.
   * @param expectedHead - observed head.
   * @param operationId - retry identity.
   * @returns new immutable revision.
   */
  @Remote
  restore(
    session: Session,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    expectedHead: ArtifactRevisionId,
    operationId: ArtifactOperationId,
  ): Promise<ArtifactRevision> {
    return this.ctx.artifacts.restore(session, artifactId, revisionId, expectedHead, operationId)
  }
  /**
   * Lease a bounded rendering of one immutable revision.
   * @param workspaceId - selected Workspace.
   * @param artifactId - owned artifact.
   * @param revisionId - immutable revision.
   * @param entry - manifest entry asset.
   * @param signal - preview-stream revocation.
   * @returns initial rendered frame followed by lease lifetime; inputs use the exact returned invocation identity.
   */
  @Remote({ mode: 'stream' })
  async *preview(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    entry: string,
    signal: AbortSignal,
  ): AsyncIterable<ArtifactFrame> {
    const stopped = AbortSignal.any([signal, this.lifetime.signal])
    stopped.throwIfAborted()
    const runtime = this.ctx.get('artifactRuntime')
    if (runtime === undefined)
      throw new Error('Artifact rendering is unavailable: no qualified independent runtime is mounted.')
    const first = await this.ctx.artifacts.read(workspaceId, artifactId, revisionId, entry, stopped)
    if (first.revision.entry !== entry) throw new Error('Artifact preview must open its immutable entry.')
    const assets: ArtifactContent[] = []
    for (const asset of first.revision.assets) {
      stopped.throwIfAborted()
      assets.push(
        asset.name === entry
          ? first
          : await this.ctx.artifacts.read(workspaceId, artifactId, revisionId, asset.name, stopped),
      )
    }
    const allocation = runtime.open({ revision: first.revision, assets }, stopped)
    this.allocations.add(allocation)
    let invocation: ArtifactInvocation
    try {
      invocation = await allocation
    } finally {
      this.allocations.delete(allocation)
    }
    if (stopped.aborted || this.ctx.workspaceRegistry.get(workspaceId) === undefined) {
      await invocation.close()
      stopped.throwIfAborted()
      throw new Error('Artifact Workspace was revoked during preview allocation.')
    }
    this.previews.set(invocation.id, { workspaceId, artifactId, revisionId, invocation })
    try {
      yield await invocation.interact(null)
      await invocation.ended
    } finally {
      await invocation.close()
      this.previews.delete(invocation.id)
    }
  }
  /**
   * Forward a closed transient input to the exact preview lease.
   * @param workspaceId - selected Workspace.
   * @param artifactId - owned artifact.
   * @param revisionId - pinned revision.
   * @param invocationId - unpredictable identity returned by the preview stream.
   * @param input - nonprivileged presentation input.
   * @returns the resulting bounded rendered frame.
   */
  @Remote
  async interact(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    invocationId: ArtifactInvocationId,
    input: ArtifactRuntimeInteraction,
  ): Promise<ArtifactFrame> {
    const lease = this.previews.get(invocationId)
    if (
      lease === undefined ||
      lease.workspaceId !== workspaceId ||
      lease.artifactId !== artifactId ||
      lease.revisionId !== revisionId ||
      this.ctx.workspaceRegistry.get(workspaceId) === undefined
    )
      throw new Error('Artifact preview lease is revoked or outside this Workspace revision.')
    return lease.invocation.interact(input)
  }
}
export default ArtifactsController
