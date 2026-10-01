/** Info view store: one Session Info reading beside its independently settled spend reading. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  OpenRouterSpendFailure,
  OpenRouterSpendSnapshot,
} from '@deepseek-ai/dsh-openrouter-spend/types'
import type { SessionInfoFailure, SessionInfoSnapshot } from '@deepseek-ai/dsh-session-info/types'

/** Primary Session Info reading: in flight, settled, or one Host-reported failure. */
export type InfoInfoState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: SessionInfoSnapshot }
  | { readonly status: 'failed'; readonly failure: SessionInfoFailure }

/** Nested spend reading: in flight, settled, or one stated failure (carrier or Host). */
export type InfoSpendState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: OpenRouterSpendSnapshot }
  | { readonly status: 'failed'; readonly failure: OpenRouterSpendFailure }

/** What the view renders: both readings settle independently. */
export interface InfoViewState {
  /** Session Info reading; a failure here fails the whole view. */
  readonly info: InfoInfoState
  /** OpenRouter spend reading; a failure here degrades only the spend block. */
  readonly spend: InfoSpendState
}

/** The view store's complete write set. */
type InfoActions = {
  begin: (draft: InfoViewState) => void
  infoSucceed: (draft: InfoViewState, snapshot: SessionInfoSnapshot) => void
  infoFail: (draft: InfoViewState, failure: SessionInfoFailure) => void
  spendSucceed: (draft: InfoViewState, snapshot: OpenRouterSpendSnapshot) => void
  spendFail: (draft: InfoViewState, failure: OpenRouterSpendFailure) => void
}

/**
 * Replace one nested reading wholesale: the state's fields are readonly in
 * the contract, so the write goes through a mutable view of the draft (the
 * same single-write discipline the previous arm-replacement helper used).
 * @param draft - the store's state as an immer draft.
 * @param key - the reading to replace.
 * @param next - the arm to publish.
 */
function replaceReading(draft: InfoViewState, key: 'info' | 'spend', next: unknown): void {
  ;(draft as unknown as Record<string, unknown>)[key] = next
}

/**
 * Create the Info view store handle.
 * @returns a handle instantiated once per rendered Session scope.
 */
export function createInfoStore(): EngineStoreHandle<InfoViewState, InfoActions> {
  return defineStore({
    init: (): InfoViewState => ({ info: { status: 'loading' }, spend: { status: 'loading' } }),
    actions: {
      begin: (draft) => {
        replaceReading(draft, 'info', { status: 'loading' })
        replaceReading(draft, 'spend', { status: 'loading' })
      },
      infoSucceed: (draft, snapshot) => {
        replaceReading(draft, 'info', { status: 'ready', snapshot })
      },
      infoFail: (draft, failure) => {
        replaceReading(draft, 'info', { status: 'failed', failure })
      },
      spendSucceed: (draft, snapshot) => {
        replaceReading(draft, 'spend', { status: 'ready', snapshot })
      },
      spendFail: (draft, failure) => {
        replaceReading(draft, 'spend', { status: 'failed', failure })
      },
    },
  })
}
