/** Prompt view store: one reading of the Session's model-visible prompt state. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionInfoFailure, SessionPromptSnapshot } from '@deepseek-ai/dsh-session-info/types'

/** The Session's prompt reading: in flight, settled, or one Host-reported failure. */
export type PromptReadingState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: SessionPromptSnapshot }
  | { readonly status: 'failed'; readonly failure: SessionInfoFailure }

/** What the Prompt view renders. */
export interface PromptViewState {
  /** Prompt and tool-catalog reading; a failure here fails the whole view. */
  readonly prompt: PromptReadingState
}

/** The view store's complete write set. */
type PromptActions = {
  begin: (draft: PromptViewState) => void
  succeed: (draft: PromptViewState, snapshot: SessionPromptSnapshot) => void
  fail: (draft: PromptViewState, failure: SessionInfoFailure) => void
}

/**
 * Replace the reading wholesale: the state's fields are readonly in the
 * contract, so the write goes through a mutable view of the draft (the same
 * single-write discipline the Info store uses).
 * @param draft - the store's state as an immer draft.
 * @param next - the arm to publish.
 */
function replaceReading(draft: PromptViewState, next: PromptReadingState): void {
  ;(draft as unknown as Record<string, unknown>)['prompt'] = next
}

/**
 * Create the Prompt view store handle.
 * @returns a handle instantiated once per rendered Session scope.
 */
export function createPromptStore(): EngineStoreHandle<PromptViewState, PromptActions> {
  return defineStore({
    init: (): PromptViewState => ({ prompt: { status: 'loading' } }),
    actions: {
      begin: (draft) => {
        replaceReading(draft, { status: 'loading' })
      },
      succeed: (draft, snapshot) => {
        replaceReading(draft, { status: 'ready', snapshot })
      },
      fail: (draft, failure) => {
        replaceReading(draft, { status: 'failed', failure })
      },
    },
  })
}
