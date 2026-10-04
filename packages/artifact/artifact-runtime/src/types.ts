/** Nonprivileged artifact presentation protocol. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ArtifactRevision, ArtifactContent } from '@deepseek-ai/dsh-artifact/types'
/** Unpredictable invocation identifier bound to one immutable revision. */
export type ArtifactInvocationId = Branded<'ArtifactInvocationId'>
/** Complete verified assets supplied only by the artifact owner. */
export interface ArtifactRuntimeInput {
  readonly revision: ArtifactRevision
  readonly assets: readonly ArtifactContent[]
}
/** Allowed nonprivileged presentation keys; system shortcuts are excluded. */
export type ArtifactRuntimeKey =
  | 'Tab'
  | 'Enter'
  | 'Space'
  | 'Backspace'
  | 'Delete'
  | 'Escape'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
/** Closed transient presentation inputs; there is no tool, filesystem, or network message. */
export type ArtifactRuntimeInteraction =
  | { readonly type: 'pointer'; readonly x: number; readonly y: number }
  | { readonly type: 'key'; readonly key: ArtifactRuntimeKey }
  | { readonly type: 'text'; readonly text: string }
/** Bounded rendered raster and inert accessible text. */
export interface ArtifactFrame {
  readonly invocationId: ArtifactInvocationId
  readonly revisionId: ArtifactRevision['revisionId']
  readonly png: string
  readonly text: string
  readonly width: number
  readonly height: number
}
/** Single independently sandboxed lifetime. */
export interface ArtifactInvocation {
  readonly id: ArtifactInvocationId
  /** Settles only after runtime removal; rejects if resource revocation failed. */
  readonly ended: Promise<void>
  /** @param input - closed transient input. @returns next bounded presentation frame. */
  interact(input: ArtifactRuntimeInteraction | null): Promise<ArtifactFrame>
  /** @returns completion after runtime removal and queued work settlement. */
  close(): Promise<void>
}
