import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import ToolPolicyService, { ToolPolicyProviderId } from '../src/index.ts'
import * as ToolPolicyInvariant from '../src/invariant.ts'

describe('ToolPolicyService', () => {
  it('selects exactly one provider and disposal removes it', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(ToolPolicyService, {})
    await fiber
    const dispose = ctx.toolPolicy.register(ToolPolicyProviderId('only'), { evaluate: async () => undefined })
    await expect(ctx.toolPolicy.evaluate({} as never)).resolves.toBeUndefined()
    expect(() => ctx.toolPolicy.register(ToolPolicyProviderId('only'), { evaluate: async () => undefined })).toThrow(/duplicate/)
    dispose()
    await expect(ctx.toolPolicy.evaluate({} as never)).rejects.toThrow(/no providers/)
    await fiber.dispose()
  })

  it('uses an explicitly configured provider', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(ToolPolicyService, { providers: ['b'] })
    await fiber
    ctx.toolPolicy.register(ToolPolicyProviderId('a'), { evaluate: async () => undefined })
    ctx.toolPolicy.register(ToolPolicyProviderId('b'), { evaluate: async () => ({
      providerId: ToolPolicyProviderId('b'), decision: 'allow', risk: 0, categories: [], reason: 'safe', opinions: [],
    }) })
    await expect(ctx.toolPolicy.evaluate({} as never)).resolves.toMatchObject({ providerId: 'b' })
    await fiber.dispose()
  })

  it('routes across configured providers and combines overlapping verdicts conservatively', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(ToolPolicyService, { providers: ['shell', 'mcp'] })
    await fiber
    ctx.toolPolicy.register(ToolPolicyProviderId('shell'), { evaluate: async request => request.toolName === 'bash'
      ? { providerId: ToolPolicyProviderId('shell'), decision: 'allow', risk: 5, categories: ['shell'], reason: 'safe', opinions: [] }
      : undefined })
    ctx.toolPolicy.register(ToolPolicyProviderId('mcp'), { evaluate: async request => request.toolName === 'bash'
      ? { providerId: ToolPolicyProviderId('mcp'), decision: 'ask', risk: 70, categories: ['external'], reason: 'confirm', opinions: [] }
      : undefined })

    await expect(ctx.toolPolicy.evaluate({ toolName: 'bash' } as never)).resolves.toMatchObject({
      providerId: 'tool-policy', decision: 'ask', risk: 70,
    })
    await expect(ctx.toolPolicy.evaluate({ toolName: 'read' } as never)).resolves.toBeUndefined()
    await fiber.dispose()
  })
})

describe('tool-policy durable invariants', () => {
  it('accepts a reconstructible intent request and rejects invalid selectors', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ToolPolicyInvariant)
    const session = ctx.sessions.create(SessionId('tool-policy-invariant'))
    session.append('turn/start', { turn: 1 })
    const user = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'inspect' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const callId = CallId('call')
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{}' })
    expect(() => {
      session.append('tool-policy/classifier-request', {
        turn: 1,
        callId,
        providerId: ToolPolicyProviderId('intent:mock/reviewer'),
        route: { provider: 'mock', model: 'reviewer' },
        purpose: 'intent',
        input: { kind: 'intent', userMessageSeq: user.seq, maxUserMessageChars: 100, maxIntentChars: 100 },
        request: { system: 'fixed', temperature: 0, maxTokens: 10 },
      })
    }).not.toThrow()
    expect(() => {
      session.append('tool-policy/classifier-request', {
        turn: 1,
        callId,
        providerId: ToolPolicyProviderId('intent:mock/reviewer'),
        route: { provider: 'mock', model: 'reviewer' },
        purpose: 'intent',
        input: { kind: 'intent', userMessageSeq: 999, maxUserMessageChars: 100, maxIntentChars: 100 },
        request: { system: 'fixed', temperature: 0, maxTokens: 10 },
      })
    }).toThrow(/earlier direct user message/)
    expect(() => {
      session.append('tool-policy/classifier-request', {
        turn: 1,
        callId,
        providerId: ToolPolicyProviderId('effect:mock/reviewer'),
        route: { provider: 'mock', model: 'reviewer' },
        purpose: 'effect-primary',
        input: { kind: 'intent', maxUserMessageChars: 100, maxIntentChars: 100 },
        request: { system: 'fixed', temperature: 0, maxTokens: 10 },
      })
    }).toThrow(/purpose must match/)
  })
})
