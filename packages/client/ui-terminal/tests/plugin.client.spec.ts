/** Real slot and locale registrations release shell streams on plugin unload. */
import { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyHost } from '../src/index.ts'
import type { TerminalInjected } from '../src/client/TerminalView.tsx'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({ name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } } as never, () => null)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const terminal = vi.fn(async function* (_request: unknown, signal: AbortSignal) {
    const ended = Promise.withResolvers<undefined>()
    signal.addEventListener('abort', () => { ended.resolve(undefined) }, { once: true })
    yield { kind: 'ready', cwd: '/session', maxInputBytes: 64 }
    await ended.promise
  })
  const terminalInput = vi.fn(async () => ({ ok: true }))
  const terminalResize = vi.fn(async () => ({ ok: true }))
  ctx.provide('remote', { $on: () => () => {}, session: { terminal, terminalInput, terminalResize } } as unknown as ClientRemote)
  ctx.provide('remote.session', { terminal, terminalInput, terminalResize } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('en')
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  return { ctx, fiber, terminal, terminalInput, terminalResize }
}

describe('terminal view registration', () => {
  it('shares a Session binding and releases its stream, view and dictionary on unload', async () => {
    const b = await bench()
    const entry = b.ctx.slots.entries('conversation.view').find(item => item.options.id === 'terminal')
    if (entry === undefined) throw new Error('terminal view missing')
    const bind = entry.inject as unknown as (id: SessionId) => TerminalInjected
    const first = bind('one' as SessionId)
    expect(bind('one' as SessionId)).toBe(first)
    expect(bind('two' as SessionId)).not.toBe(first)
    const t = b.ctx.locale.bind('sessionTerminal')
    expect(t('view')).toBe('Terminal')
    expect(entry.options.label).toBeTypeOf('function')
    expect((entry.options.label as () => string)()).toBe('Terminal')
    first.start(24, 80)
    await vi.waitFor(() => { expect(first.hooks.terminal.getSnapshot().status).toBe('open') })
    first.input('pwd\n')
    first.resize(30, 90)
    await vi.waitFor(() => { expect(b.terminalInput).toHaveBeenCalledOnce() })
    expect(b.terminalResize).toHaveBeenCalledOnce()
    await first.restart(30, 90)
    await vi.waitFor(() => { expect(b.terminal).toHaveBeenCalledTimes(2) })
    await b.fiber.dispose()
    expect(first.hooks.terminal.getSnapshot().status).toBe('closed')
    expect(b.ctx.slots.entries('conversation.view')).toEqual([])
    expect(t('view')).not.toBe('Terminal')
  })

  it('validates configured display retention and scrollback', async () => {
    for (const config of [{ outputChars: 3 }, { outputChars: 4, scrollback: -1 }, { outputChars: 4, scrollback: 0 }]) {
      const b = await bench()
      await b.fiber.dispose()
      if (config.scrollback === 0) {
        const fiber = b.ctx.plugin({ inject, apply }, config)
        await fiber.await()
        await fiber.dispose()
      } else expect(() => { apply(b.ctx, config) }).toThrow('terminal outputChars')
    }
  })

  it('keeps the Host entry inert', () => { expect(applyHost).not.toThrow() })
})
