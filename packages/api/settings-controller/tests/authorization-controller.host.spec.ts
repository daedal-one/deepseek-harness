import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AuthorizationController } from '../src/authorization.ts'
import type { AccountPromptId, ProviderAccountUpdate } from '../src/types.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

const key = credentialKey('llm-pi-ai', 'openai-codex')
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function boot(run: (session: AuthorizationSession, ctx: Context) => Promise<void>): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  ctx.authorization.registerFlow({ key, label: 'Codex', methods: [{ id: 'oauth', label: 'Sign in' }], run: session => run(session, ctx) })
  return ctx
}

async function question(stream: AsyncIterable<ProviderAccountUpdate>): Promise<ProviderAccountUpdate> {
  for await (const value of { [Symbol.asyncIterator]: () => ({ next: () => stream[Symbol.asyncIterator]().next() }) }) {
    if (value.prompt !== undefined) return value
  }
  throw new Error('No question was delivered')
}

describe('browser account authorization', () => {
  it('relays a choice and device code, commits the account, and signs out without returning credentials', async () => {
    const ctx = await boot(async (session, host) => {
      const choice = await session.prompt({ kind: 'select', message: 'Choose a login', options: [{ id: 'device', label: 'Device code' }] })
      expect(choice).toBe('device')
      session.notify({ message: 'Enter the code', url: 'https://auth.example/device', code: 'ABCD' })
      await session.prompt({ kind: 'secret', message: 'Confirmation' })
      await host.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { access: 'never-return-this' } }))
    })
    const api = ctx.authorizationController
    expect(await api.list()).toEqual([{ key, label: 'Codex', configured: false, inFlight: false, methods: [{ id: 'oauth', label: 'Sign in' }] }])
    const stream = api.signIn(key, 'oauth', new AbortController().signal)
    const first = await question(stream)
    expect(() => { api.answer(first.id, brandString<AccountPromptId>('stale'), 'device') }).toThrow('no longer available')
    expect(() => { api.answer(first.id, first.prompt!.id, 'invalid') }).toThrow('no longer available')
    api.answer(first.id, first.prompt!.id, 'device')
    const next = await question(stream)
    expect(next).toMatchObject({ url: 'https://auth.example/device', code: 'ABCD', prompt: { kind: 'secret' } })
    api.answer(next.id, next.prompt!.id, 'secret-answer')
    const frames: ProviderAccountUpdate[] = []
    for await (const frame of stream) frames.push(frame)
    expect(frames.at(-1)?.status).toBe('authorized')
    expect(JSON.stringify([frames, await api.list()])).not.toMatch(/never-return-this|secret-answer/)
    expect((await api.list())[0]?.configured).toBe(true)
    await api.signOut(key)
    expect((await api.list())[0]?.configured).toBe(false)
  })

  it('cancels an open prompt when its browser disconnects and permits another attempt', async () => {
    const ctx = await boot(async (session) => { await session.prompt({ kind: 'text', message: 'Paste code' }) })
    const controller = new AbortController()
    const stream = ctx.authorizationController.signIn(key, 'oauth', controller.signal)
    const first = await question(stream)
    controller.abort()
    const frames: ProviderAccountUpdate[] = []
    for await (const frame of stream) frames.push(frame)
    expect(frames.at(-1)?.status).toBe('cancelled')
    expect(() => { ctx.authorizationController.answer(first.id, first.prompt!.id, 'late') }).toThrow('no longer available')
    expect(ctx.authorization.describe(key)?.inFlight).toBe(false)
  })

  it('filters executable URLs and redacts provider errors', async () => {
    const ctx = await boot(async (session) => {
      session.notify({ message: 'Continue', url: 'javascript:alert(1)' })
      throw new Error('provider echoed private-refresh-token')
    })
    const frames: ProviderAccountUpdate[] = []
    for await (const frame of ctx.authorizationController.signIn(key, 'oauth', new AbortController().signal)) frames.push(frame)
    expect(frames.at(-1)?.status).toBe('failed')
    expect(JSON.stringify(frames)).not.toMatch(/javascript:|private-refresh-token/)
  })
})
