/** Immutable publication and Workspace artifact vocabulary. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
/** Host-assigned artifact identity; never a storage path or bearer credential. */
export type ArtifactId = Branded<'ArtifactId'>
/** Host-assigned immutable revision identity. */
export type ArtifactRevisionId = Branded<'ArtifactRevisionId'>
/** Caller retry identity scoped to its creating Session. */
export type ArtifactOperationId = Branded<'ArtifactOperationId'>
/** Closed execution policy; unknown policies are refused. */
export type ArtifactProfile = 'document' | 'interactive-local'
/** One immutable, explicitly published asset. */
export interface ArtifactAsset {
  readonly name: string
  readonly mediaType: string
  readonly sha256: string
  readonly file: FileAttachmentRef
}
/** Complete immutable revision and its durable provenance. */
export interface ArtifactRevision {
  readonly artifactId: ArtifactId
  readonly revisionId: ArtifactRevisionId
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly operationId: ArtifactOperationId
  readonly parent: ArtifactRevisionId | null
  readonly restoredFrom: ArtifactRevisionId | null
  readonly title: string
  readonly entry: string
  readonly profile: ArtifactProfile
  readonly capabilities: readonly ['published-assets', 'transient-input'] | readonly ['published-assets']
  readonly assets: readonly ArtifactAsset[]
  readonly createdAt: string
}
/** Inline asset input; publication never discovers files or follows URLs. */
export interface ArtifactAssetInput {
  readonly name: string
  readonly mediaType: string
  readonly data: string
}
/** A complete proposed revision, with explicit optimistic concurrency. */
export interface ArtifactPublish {
  readonly operationId: ArtifactOperationId
  readonly artifactId: ArtifactId | null
  readonly expectedHead: ArtifactRevisionId | null
  readonly title: string
  readonly entry: string
  readonly profile: ArtifactProfile
  readonly assets: readonly ArtifactAssetInput[]
}
/** New head plus the number of retained immutable revisions. */
export interface ArtifactSummary {
  readonly head: ArtifactRevision
  readonly revisionCount: number
}
/** Bounded deterministic catalogue page; cursor belongs to this Workspace. */
export interface ArtifactPage {
  readonly items: readonly ArtifactSummary[]
  readonly next: ArtifactId | null
}
/** Interrupted operation retained until explicit reconciliation. */
export interface ArtifactPending {
  readonly artifactId: ArtifactId
  readonly revisionId: ArtifactRevisionId
  readonly sessionId: SessionId
  readonly operationId: ArtifactOperationId
  readonly createdAt: string
}
/** Verified complete bytes of one explicitly selected revision asset. */
export interface ArtifactContent {
  readonly revision: ArtifactRevision
  readonly asset: ArtifactAsset
  readonly data: string
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete publication manifest; bytes precede this durable event. */
    'artifact/published': { readonly revision: ArtifactRevision }
  }
}
