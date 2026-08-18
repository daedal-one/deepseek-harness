import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import ToolPolicyService from '@deepseek-ai/dsh-tool-policy'
import { describe, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.ts'
import * as shellPlugin from '../src/index.ts'

const INTENT_ALLOW = JSON.stringify({
  userSummary: 'inspect system information',
  agentSummary: 'inspect system information',
  allowedEffects: ['host-read'],
  forbiddenEffects: ['credential-access'],
  alignment: 'aligned',
})
const EFFECT_ALLOW = JSON.stringify({ effects: ['host-read'], risk: 10, reason: 'reads host information' })

class RoutedAdapter extends LlmAdapter {
  readonly seen: GenerateOptions[] = []
  active = 0
  maxActive = 0

  constructor(private readonly outputs: Readonly<Record<string, readonly string[]>>, private readonly delayMs = 0) { super() }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options)
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    if (this.delayMs > 0) await new Promise(resolve => setTimeout(resolve, this.delayMs))
    const queue = this.outputs[options.provider] ?? []
    const index = this.seen.filter(seen => seen.provider === options.provider).length - 1
    const text = queue[index] ?? queue.at(-1) ?? 'not-json'
    this.active -= 1
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function makeConfig(timeoutMs = 50, intent: Config['intent'] = { provider: 'intent', model: 'i-model' }): Config {
  return {
    id: 'shell',
    mappings: [{ tool: 'bash', commandArgument: 'command', intentArgument: 'description' }],
    intent,
    primary: { provider: 'primary', model: 'p-model' },
    secondary: { provider: 'secondary', model: 's-model' },
    timeoutMs,
    maxTokens: 80,
    maxCommandChars: 1_000,
    maxUserMessageChars: 100,
    maxIntentChars: 100,
    maxOutputChars: 1_000,
    maxSummaryChars: 80,
    maxReasonChars: 80,
    maxEffects: 8,
    rules: [],
  }
}

function fakeAgent(options: { provider: string; model: string } = { provider: 'acting', model: 'a-model' }) {
  const events: Array<Record<string, unknown>> = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'inspect it' }] } },
    { seq: 3, type: 'tool/call', data: { callId: CallId('c'), name: 'bash', arguments: '{}' } },
  ]
  const session = {
    id: 'session',
    header: { id: 'session', cwd: process.cwd() },
    events,
    append(type: string, data: unknown) {
      const event = { seq: events.length + 1, type, data }
      events.push(event)
      return event
    },
  }
  return { agent: { session, options } as unknown as Agent, events }
}

async function setup(adapter?: LlmAdapter, timeoutMs = 50) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolPolicyService, {})
  if (adapter !== undefined) ctx.llm.registerAdapter(['intent', 'primary', 'secondary'], adapter)
  apply(ctx, makeConfig(timeoutMs))
  return ctx
}

function evaluate(ctx: Context, agent: Agent, signal = new AbortController().signal) {
  return ctx.toolPolicy.evaluate({
    callId: CallId('c'), toolName: 'bash', arguments: { command: 'uname -a', description: 'inspect' }, agent, signal,
  })
}

describe('shell classifier dispatch', () => {
  it('reviews intent and effects concurrently without duplicating their raw inputs in the audit event', async () => {
    const adapter = new RoutedAdapter({ intent: [INTENT_ALLOW], primary: [EFFECT_ALLOW] }, 5)
    const ctx = await setup(adapter)
    const { agent, events } = fakeAgent()
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow', risk: 10 })
    expect(adapter.maxActive).toBe(2)
    expect(adapter.seen).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'intent', model: 'i-model', temperature: 0, maxTokens: 80 }),
      expect.objectContaining({ provider: 'primary', model: 'p-model', temperature: 0, maxTokens: 80 }),
    ]))
    const requests = events.filter(event => event.type === 'tool-policy/classifier-request')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.data).toMatchObject({
      purpose: 'intent', input: { kind: 'intent', userMessageSeq: 2, intentArgument: 'description', maxUserMessageChars: 100, maxIntentChars: 100 },
    })
    expect(requests[1]?.data).toMatchObject({
      purpose: 'effect-primary', input: { kind: 'effect', commandArgument: 'command', maxCommandChars: 1_000 },
    })
    expect(JSON.stringify(requests)).not.toContain('inspect it')
    expect(JSON.stringify(requests)).not.toContain('uname -a')
  })

  it('uses the secondary effect route only when the primary result is invalid', async () => {
    const adapter = new RoutedAdapter({
      intent: [INTENT_ALLOW],
      primary: ['{"effects":["host-read"],"risk":0,"reason":"x","extra":true}'],
      secondary: [EFFECT_ALLOW],
    })
    const ctx = await setup(adapter)
    const { agent } = fakeAgent()
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow', risk: 10 })
    expect(adapter.seen.map(item => item.provider)).toEqual(expect.arrayContaining(['intent', 'primary', 'secondary']))
  })

  it('does not use secondary evidence to override a validated sensitive effect', async () => {
    const adapter = new RoutedAdapter({
      intent: [INTENT_ALLOW],
      primary: ['{"effects":["network-read"],"risk":45,"reason":"uses the network"}'],
      secondary: [EFFECT_ALLOW],
    })
    const ctx = await setup(adapter)
    const { agent } = fakeAgent()
    const verdict = await evaluate(ctx, agent)
    expect(verdict?.decision).toBe('ask')
    expect(verdict?.categories).toContain('network-read')
    expect(adapter.seen.some(item => item.provider === 'secondary')).toBe(false)
  })

  it('fails closed when intent evidence or every effect route is unavailable', async () => {
    const unavailable = await setup()
    const first = fakeAgent()
    await expect(evaluate(unavailable, first.agent)).resolves.toMatchObject({
      decision: 'ask', reason: 'independent intent review is unavailable',
    })

    const malformed = await setup(new RoutedAdapter({ intent: [INTENT_ALLOW], primary: ['bad'], secondary: ['bad'] }))
    const second = fakeAgent()
    await expect(evaluate(malformed, second.agent)).resolves.toMatchObject({
      decision: 'ask', reason: 'independent authorization evidence is unavailable',
    })
  })

  it('does not send an auxiliary request to the acting model route', async () => {
    const adapter = new RoutedAdapter({ intent: [INTENT_ALLOW], secondary: [EFFECT_ALLOW] })
    const ctx = await setup(adapter)
    const { agent } = fakeAgent({ provider: 'primary', model: 'p-model' })
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow' })
    expect(adapter.seen.map(item => item.provider)).toEqual(expect.arrayContaining(['intent', 'secondary']))
    expect(adapter.seen.some(item => item.provider === 'primary')).toBe(false)
  })

  it('shares concurrent exact auxiliary inputs', async () => {
    const adapter = new RoutedAdapter({ intent: [INTENT_ALLOW], primary: [EFFECT_ALLOW] }, 5)
    const ctx = await setup(adapter)
    const { agent } = fakeAgent()
    await Promise.all([evaluate(ctx, agent), evaluate(ctx, agent)])
    expect(adapter.seen).toHaveLength(2)
  })

  it('preserves caller cancellation', async () => {
    class WaitingAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (!options.signal?.aborted) {
          await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => { resolve() }, { once: true }))
        }
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      }
    }
    const ctx = await setup(new WaitingAdapter())
    const { agent } = fakeAgent()
    const controller = new AbortController()
    const pending = evaluate(ctx, agent, controller.signal)
    const reason = new Error('caller stopped')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('fails closed when the classifier timeout wins', async () => {
    class WaitingAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => { resolve() }, { once: true }))
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      }
    }
    const ctx = await setup(new WaitingAdapter(), 1)
    const { agent } = fakeAgent()
    const verdict = await evaluate(ctx, agent)
    expect(verdict?.decision).toBe('ask')
    expect(verdict?.categories).toContain('unavailable')
  })

  it('rejects non-independent configured routes', () => {
    const ctx = new Context()
    const config = makeConfig(50, { provider: 'primary', model: 'p-model' })
    expect(() => { apply(ctx, config) }).toThrow(/independent routes/)
  })

  it('removes its provider registration on plugin disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ToolPolicyService, {})
    const fiber = ctx.plugin(shellPlugin, makeConfig())
    await fiber
    const { agent } = fakeAgent()
    await expect(ctx.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'pwd' }, agent, signal: new AbortController().signal,
    })).resolves.toMatchObject({ decision: 'allow' })
    await fiber.dispose()
    await expect(ctx.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'pwd' }, agent, signal: new AbortController().signal,
    })).rejects.toThrow(/no providers are registered/)
  })
})
