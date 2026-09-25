/**
 * Client half of the OpenRouter spend plugin: one localized
 * conversation-view entry that reads the Host openrouterSpend reading
 * (key spend, limit, and session estimate) into a per-Session store the
 * view renders.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the locale plugin's `ctx.locale` Context merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the generated `remote.openrouterSpend` namespace on the remote service.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the 'conversation.view' SlotMap row, declared by the slot's owning package.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SpendView, type SpendViewInjected } from './SpendView.tsx'
import { en, NS } from './locales.ts'
import { createSpendStore } from './store.ts'

export { NS } from './locales.ts'
export type { SpendKey } from './locales.ts'
export type { SpendViewInjected, SpendViewProps } from './SpendView.tsx'
export type { SpendViewState } from './store.ts'
export { createSpendStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'spend': SpendKey
  }
}

/** Required client services for the locale dictionary and the spend contribution. */
export const inject = ['slots', 'locale', 'remote', 'remote.openrouterSpend']

/**
 * Register the spend view contribution.
 * @param ctx - the plugin client context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'ui-openrouter-spend: dictionaries')
  const t = ctx.locale.bind(NS)
  const spendStore = createSpendStore()

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'spend',
    order: 20,
    locale: NS,
    label: () => t('view.spend'),
    store: spendStore,
    inject: (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createSpendStore>>): SpendViewInjected => {
      // The renderer caches the inject face per (entry, Session binding), so
      // this closure is the session view instance; its controller is the only
      // in-flight read for that instance.
      let controller: AbortController | undefined
      const load = (): void => {
        controller?.abort()
        // The read's own controller, not the shared slot: an aborted read
        // settles stale and must not clobber the read that replaced it.
        const own = new AbortController()
        controller = own
        actions.begin()
        void ctx.remote.openrouterSpend.read({ sessionId }, own.signal)
          .then((result) => {
            if (own.signal.aborted) return
            // The generated face folds carrier failures into the result; the
            // Host's own business failure carries one of the five reasons.
            if (!result.ok) {
              actions.fail({ reason: 'unreachable', detail: result.error.message })
              return
            }
            if (result.value.ok) actions.succeed(result.value.value)
            else actions.fail(result.value.error)
          })
          .catch((error: unknown) => {
            if (own.signal.aborted) return
            actions.fail({ reason: 'unreachable', detail: String(error) })
          })
      }
      return { load }
    },
  }, SpendView))
}
