import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as EnglishOutputInvariant from '../src/invariant.ts'
import type {} from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(EnglishOutputInvariant)
  return ctx
}

function requestData() {
  return {
    turn: 1,
    step: 1,
    target: { provider: 'main', model: 'selected' },
    translator: { provider: 'translator', model: 'english' },
    system: 'translate',
    messages: [createUserMessage({ source: { kind: 'plugin' as const, plugin: 'test' }, content: [{ type: 'text' as const, text: 'DATA' }] })],
    maxTokens: 100,
    blocks: [{ index: 0, type: 'text' as const, content: 'Hello' }],
  }
}

describe('English output durable invariant', () => {
  it('accepts a request/result pair followed by the canonical message', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('valid'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('english-output/translation-request', requestData())
    session.append('english-output/translation-result', { turn: 1, step: 1, status: 'translated', blockIndexes: [0] })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({ source: { provider: 'main', model: 'selected' }, content: [{ type: 'text', text: 'English' }] }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(() => { session.append('step/end', { turn: 1, step: 1 }) }).not.toThrow()
  })

  it('rejects a translation request left unsettled at step end', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('unsettled'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('english-output/translation-request', requestData())
    expect(() => { session.append('step/end', { turn: 1, step: 1 }) }).toThrow(/has no result/)
  })

  it('rejects a result whose indexes differ from its request', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('indexes'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('english-output/translation-request', requestData())
    session.append('english-output/translation-result', { turn: 1, step: 1, status: 'preserved', blockIndexes: [1] })
    expect(() => { session.append('step/end', { turn: 1, step: 1 }) }).toThrow(/does not identify/)
  })
})
