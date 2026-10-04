/** Register the interactive terminal view and its connection-owned Session models. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TerminalModel } from './model.ts'
import { TerminalView, type TerminalInjected } from './TerminalView.tsx'
import { en } from './locales.ts'

/** Browser terminal display limits. */
export interface Config {
  /** Retained raw UTF-16 output characters for replay after tab switches. */
  readonly outputChars?: number
  /** xterm scrollback line limit. */
  readonly scrollback?: number
}

/** Required composition and generated Remote services. */
export const inject = ['slots', 'locale', 'remote', 'remote.session']

/**
 * Register one localized Terminal tab; plugin disposal closes every owned stream.
 * @param ctx - browser root composition.
 * @param config - display retention limits.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const outputChars = config.outputChars ?? 1024 * 1024
  const scrollback = config.scrollback ?? 5000
  if (!Number.isSafeInteger(outputChars) || outputChars < 4 || !Number.isSafeInteger(scrollback) || scrollback < 0) {
    throw new Error('terminal outputChars must be at least 4 and scrollback must be nonnegative integers')
  }
  const models = new Map<SessionId, TerminalModel>()
  const bindings = new Map<SessionId, TerminalInjected>()
  ctx.effect(() => ctx.locale.register('sessionTerminal', { en }), 'ui-terminal: dictionaries')
  const t = ctx.locale.bind('sessionTerminal')
  ctx.effect(() => async () => {
    await Promise.all([...models.values()].map(model => model.dispose()))
    models.clear()
    bindings.clear()
  }, 'ui-terminal: streams')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'terminal', order: 20, locale: 'sessionTerminal', label: () => t('view'),
    inject: (sessionId: SessionId): TerminalInjected => {
      let binding = bindings.get(sessionId)
      if (binding === undefined) {
        const model = new TerminalModel(ctx.remote, sessionId, outputChars)
        models.set(sessionId, model)
        binding = { hooks: { terminal: model.source }, scrollback,
          start: (rows, cols) => { model.start(rows, cols) },
          input: (data) => { model.input(data) }, resize: (rows, cols) => { model.resize(rows, cols) },
          restart: (rows, cols) => model.restart(rows, cols) }
        bindings.set(sessionId, binding)
      }
      return binding
    },
  }, TerminalView))
}
