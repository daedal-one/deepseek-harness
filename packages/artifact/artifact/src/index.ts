/** Workspace artifact capability: immutable publication, history, and verified reads. @module */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  ArtifactPending,
  ArtifactContent,
  ArtifactId,
  ArtifactPage,
  ArtifactPublish,
  ArtifactRevision,
  ArtifactRevisionId,
  ArtifactOperationId,
} from './types.ts'
export type * from './types.ts'
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * An artifact catalogue changes after its durable head commit.
     * @param workspaceId - exact Workspace whose catalogue changed.
     * @mode emit
     */
    'artifact/changed'(workspaceId: WorkspaceId): void
  }
  interface Context {
    artifacts: Artifacts
  }
}
/** Artifact ownership is checked by the provider on every operation. */
export abstract class Artifacts extends Service {
  /**
   * @param ctx - capability registration context.
   */
  constructor(ctx: Context) {
    super(ctx, 'artifacts')
  }
  /**
   * List recoverable publication reservations for the selected Workspace.
   * @param workspaceId - selected durable Workspace.
   * @returns bounded interrupted operations.
   */
  abstract pending(workspaceId: WorkspaceId): Promise<readonly ArtifactPending[]>
  /**
   * Resolve an interrupted operation against durable Session evidence.
   * @param workspaceId - selected durable Workspace.
   * @param revisionId - interrupted operation's assigned revision.
   * @returns committed revision, or null when no publication event exists and the reservation was safely abandoned.
   */
  abstract reconcile(
    workspaceId: WorkspaceId,
    revisionId: ArtifactRevisionId,
  ): Promise<ArtifactRevision | null>
  /**
   * Persist and checkpoint one complete immutable revision.
   * @param session - exact live creating Session.
   * @param request - complete revision and retry identity.
   * @returns durable committed revision.
   */
  abstract publish(session: Session, request: ArtifactPublish): Promise<ArtifactRevision>
  /**
   * Read committed artifact heads without activating creating Sessions.
   * @param workspaceId - selected durable Workspace.
   * @param after - exclusive artifact cursor.
   * @returns bounded current-head catalogue.
   */
  abstract list(workspaceId: WorkspaceId, after: ArtifactId | null): Promise<ArtifactPage>
  /**
   * Read an artifact’s immutable revision history.
   * @param workspaceId - selected durable Workspace.
   * @param artifactId - artifact owned by it.
   * @param before - exclusive revision cursor.
   * @returns bounded newest-first history.
   */
  abstract history(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    before: ArtifactRevisionId | null,
  ): Promise<readonly ArtifactRevision[]>
  /**
   * Verify and return bytes belonging to an exact Workspace revision.
   * @param workspaceId - selected durable Workspace.
   * @param artifactId - owned artifact.
   * @param revisionId - exact retained revision.
   * @param name - exact manifest asset name.
   * @param signal - optional read cancellation.
   * @returns verified immutable content.
   */
  abstract read(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    name: string,
    signal?: AbortSignal,
  ): Promise<ArtifactContent>
  /**
   * Publish a retained revision as a new head with optimistic concurrency.
   * @param session - exact live Session in the artifact Workspace.
   * @param artifactId - owned artifact.
   * @param revisionId - immutable restore source.
   * @param expectedHead - head observed by caller.
   * @param operationId - scoped retry identity.
   * @returns a new revision preserving history.
   */
  abstract restore(
    session: Session,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    expectedHead: ArtifactRevisionId,
    operationId: ArtifactOperationId,
  ): Promise<ArtifactRevision>
}
export default Artifacts
