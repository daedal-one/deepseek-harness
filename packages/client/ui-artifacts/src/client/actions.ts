/** Trusted gestures refuse incomplete or revoked view state before forwarding an effect. @module */
import type { ArtifactContent, ArtifactRevision, ArtifactRevisionId } from '@deepseek-ai/dsh-artifact/types'
import type { ArtifactFrame, ArtifactRuntimeInteraction } from '@deepseek-ai/dsh-artifact-runtime/types'
/** Selection and lifetime held by one trusted rendered view. */
export interface ArtifactActionState {
  readonly selected: ArtifactRevision | null
  readonly content: ArtifactContent | null
  readonly head: ArtifactRevisionId | null
  readonly frame: ArtifactFrame | null
  readonly busy: boolean
  readonly sourceText: string | null
  readonly source: HTMLTextAreaElement | null
  readonly signal: AbortSignal
}
/**
 * Keep a mutation from incomplete or closed view state out of the authorized API.
 * @param state - captured view metadata and current owner cancellation.
 * @param apply - trusted mutation with its exact selected metadata.
 * @returns a save or restore gesture that does nothing after revocation or while incomplete.
 */
export function guardMutation(
  state: () => ArtifactActionState,
  apply: (
    kind: 'save' | 'restore',
    selected: ArtifactRevision,
    content: ArtifactContent,
    head: ArtifactRevisionId,
  ) => Promise<void>,
): (kind: 'save' | 'restore') => Promise<void> {
  return async (kind) => {
    const current = state()
    if (
      current.signal.aborted ||
      current.selected === null ||
      current.content === null ||
      current.head === null ||
      current.busy
    )
      return
    await apply(kind, current.selected, current.content, current.head)
  }
}
/**
 * Forward input only from a complete live preview.
 * @param state - selected view and current owner cancellation.
 * @param apply - exact revision and invocation input operation.
 * @returns a transient gesture that does nothing without a live frame or during another action.
 */
export function guardInput(
  state: () => ArtifactActionState,
  apply: (
    input: ArtifactRuntimeInteraction,
    selected: ArtifactRevision,
    frame: ArtifactFrame,
  ) => Promise<void>,
): (input: ArtifactRuntimeInteraction) => Promise<void> {
  return async (input) => {
    const current = state()
    if (current.signal.aborted || current.selected === null || current.frame === null || current.busy) return
    await apply(input, current.selected, current.frame)
  }
}
/**
 * Export only bytes already held by the trusted view.
 * @param state - original published content and current cancellation.
 * @param apply - trusted export gesture.
 * @returns a gesture that does nothing while content is absent or the view is closed.
 */
export function guardDownload(
  state: () => ArtifactActionState,
  apply: (content: ArtifactContent) => void,
): () => void {
  return () => {
    const current = state()
    if (current.signal.aborted || current.content === null) return
    apply(current.content)
  }
}
/**
 * Submit a selection only from a complete live source control.
 * @param state - immutable content, source control, and owner cancellation.
 * @param apply - trusted bounded user-message submission.
 * @returns a gesture that does nothing without the original source or after view closure.
 */
export function guardAgentRequest(
  state: () => ArtifactActionState,
  apply: (
    selected: ArtifactRevision,
    content: ArtifactContent,
    sourceText: string,
    source: HTMLTextAreaElement,
  ) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const current = state()
    if (
      current.signal.aborted ||
      current.selected === null ||
      current.content === null ||
      current.sourceText === null ||
      current.source === null
    )
      return
    await apply(current.selected, current.content, current.sourceText, current.source)
  }
}
