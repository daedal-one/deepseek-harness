/**
 * Client half of the Session Info plugin: two localized conversation-view
 * entries — Info, which reads the Host `sessionInfo` snapshot and the
 * OpenRouter `openrouterSpend` reading, and Prompt, which reads the Host's
 * `sessionInfo/readPrompt` system prompt and tool catalog.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the locale plugin's `ctx.locale` Context merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the generated `remote.sessionInfo` and `remote.openrouterSpend`
// namespaces on the remote service.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the 'conversation.view' SlotMap row, declared by the slot's owning package.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { InfoView, type InfoViewInjected } from './InfoView.tsx'
import { PromptView, type PromptViewInjected } from './PromptView.tsx'
import { en, NS, type SessionInfoKey } from './locales.ts'
import { createInfoStore } from './store.ts'
import { createPromptStore } from './prompt-store.ts'

export { NS } from './locales.ts'
export type { SessionInfoKey } from './locales.ts'
export type { InfoViewInjected, InfoViewProps } from './InfoView.tsx'
export type { PromptViewInjected, PromptViewProps } from './PromptView.tsx'
export type { InfoInfoState, InfoSpendState, InfoViewState } from './store.ts'
export type { PromptReadingState, PromptViewState } from './prompt-store.ts'
export { createInfoStore } from './store.ts'
export { createPromptStore } from './prompt-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'sessionInfo': SessionInfoKey
  }
}

/** Required client services for the locale dictionary and both view contributions. */
export const inject = ['slots', 'locale', 'remote', 'remote.sessionInfo', 'remote.openrouterSpend']

/**
 * Register the Info and Prompt view contributions.
 * @param ctx - the plugin client context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'ui-session-info: dictionaries')
  const t = ctx.locale.bind(NS)
  const infoStore = createInfoStore()
  const promptStore = createPromptStore()

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'info',
    order: 20,
    locale: NS,
    label: () => t('view.info'),
    store: infoStore,
    inject: (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createInfoStore>>): InfoViewInjected => {
      // The renderer caches the inject face per (entry, Session binding), so
      // each closure is the session view instance; each controller is the only
      // in-flight read for that instance and source.
      let infoController: AbortController | undefined
      let spendController: AbortController | undefined
      const loadInfo = (): void => {
        infoController?.abort()
        // The read's own controller, not the shared slot: an aborted read
        // settles stale and must not clobber the read that replaced it.
        const own = new AbortController()
        infoController = own
        actions.begin()
        void ctx.remote.sessionInfo.read({ sessionId }, own.signal)
          .then((result) => {
            if (own.signal.aborted) return
            // The generated face folds carrier failures into the result; the
            // Host's own business failure carries the stated reason.
            if (!result.ok) {
              actions.infoFail({ reason: 'session-unavailable', detail: result.error.message })
              return
            }
            if (result.value.ok) actions.infoSucceed(result.value.value)
            else actions.infoFail(result.value.error)
          })
          .catch((error: unknown) => {
            if (own.signal.aborted) return
            actions.infoFail({ reason: 'session-unavailable', detail: String(error) })
          })
      }
      const loadSpend = (): void => {
        spendController?.abort()
        const own = new AbortController()
        spendController = own
        void ctx.remote.openrouterSpend.read({ sessionId }, own.signal)
          .then((result) => {
            if (own.signal.aborted) return
            if (!result.ok) {
              actions.spendFail({ reason: 'unreachable', detail: result.error.message })
              return
            }
            if (result.value.ok) actions.spendSucceed(result.value.value)
            else actions.spendFail(result.value.error)
          })
          .catch((error: unknown) => {
            if (own.signal.aborted) return
            actions.spendFail({ reason: 'unreachable', detail: String(error) })
          })
      }
      return { loadInfo, loadSpend }
    },
  }, InfoView))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'prompt',
    order: 30,
    locale: NS,
    label: () => t('view.prompt'),
    store: promptStore,
    inject: (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createPromptStore>>): PromptViewInjected => {
      let promptController: AbortController | undefined
      const loadPrompt = (): void => {
        promptController?.abort()
        const own = new AbortController()
        promptController = own
        actions.begin()
        void ctx.remote.sessionInfo.readPrompt({ sessionId }, own.signal)
          .then((result) => {
            if (own.signal.aborted) return
            if (!result.ok) {
              actions.fail({ reason: 'session-unavailable', detail: result.error.message })
              return
            }
            if (result.value.ok) actions.succeed(result.value.value)
            else actions.fail(result.value.error)
          })
          .catch((error: unknown) => {
            if (own.signal.aborted) return
            actions.fail({ reason: 'session-unavailable', detail: String(error) })
          })
      }
      return { loadPrompt }
    },
  }, PromptView))
}
