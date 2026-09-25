/** Spend view store: the in-flight or settled reading of the openrouterSpend Remote. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  OpenRouterSpendFailure,
  OpenRouterSpendSnapshot,
} from '@deepseek-ai/dsh-openrouter-spend/types'

/** What the view renders: an in-flight read, one settled reading, or one failure. */
export type SpendViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: OpenRouterSpendSnapshot }
  | { readonly status: 'failed'; readonly failure: OpenRouterSpendFailure }

/** The view store's complete write set. */
type SpendActions = {
  begin: (draft: SpendViewState) => void
  succeed: (draft: SpendViewState, snapshot: OpenRouterSpendSnapshot) => void
  fail: (draft: SpendViewState, failure: OpenRouterSpendFailure) => void
}

/**
 * Replace one readonly union arm wholesale: drop the previous arm's payload
 * keys, then stamp the new discriminant and payload on the same object, so
 * no stale member survives the transition.
 * @param draft - the store's current arm as an immer draft.
 * @param next - the arm to publish.
 */
function replaceArm(draft: SpendViewState, next: SpendViewState): void {
  const target = draft as unknown as Record<string, unknown>
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, next)
}

/**
 * Create the spend view store handle.
 * @returns a handle instantiated once per rendered Session scope.
 */
export function createSpendStore(): EngineStoreHandle<SpendViewState, SpendActions> {
  return defineStore({
    init: (): SpendViewState => ({ status: 'loading' }),
    actions: {
      begin: (draft) => {
        replaceArm(draft, { status: 'loading' })
      },
      succeed: (draft, snapshot) => {
        replaceArm(draft, { status: 'ready', snapshot })
      },
      fail: (draft, failure) => {
        replaceArm(draft, { status: 'failed', failure })
      },
    },
  })
}
