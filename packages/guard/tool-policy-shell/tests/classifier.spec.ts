import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import ToolPolicyService from '@deepseek-ai/dsh-tool-policy'
import { describe, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.ts'
import * as shellPlugin from '../src/index.ts'

const INTENT_ALLOW = 'host-read\ncredential-access\ninspect system information'
const EFFECT_ALLOW = 'aligned;host-read'

class RoutedAdapter extends LlmAdapter {
  readonly seen: GenerateOptions[] = []
  active = 0
  maxActive = 0

  constructor(private readonly outputs: Readonly<Record<string, readonly string[]>>, private readonly delayMs = 0) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: model,
      reasoning: { efforts: [{ id: ReasoningEffortId('minimal'), name: 'Minimal' }] },
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options)
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    if (this.delayMs > 0) await new Promise(resolve => setTimeout(resolve, this.delayMs))
    const queue = this.outputs[options.provider] ?? []
    const index = this.seen.filter(seen => seen.provider === options.provider).length - 1
    const text = queue[index] ?? queue.at(-1) ?? 'invalid-evidence'
    this.active -= 1
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function makeConfig(
  decisionTimeoutMs = 50,
  intent: Config['intent'] = {
    provider: 'intent', model: 'i-model', reasoningEffort: 'minimal',
  },
): Config {
  return {
    id: 'shell',
    mappings: [{ tool: 'bash', commandArgument: 'command', intentArgument: 'description' }],
    intent,
    primary: { provider: 'primary', model: 'p-model' },
    secondary: { provider: 'secondary', model: 's-model' },
    decisionTimeoutMs,
    intentContextTimeoutMs: 50,
    maxTokens: 80,
    maxCommandChars: 1_000,
    maxUserMessageChars: 100,
    maxIntentChars: 100,
    maxOutputChars: 1_000,
    maxSummaryChars: 80,
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

async function setup(adapter?: LlmAdapter, decisionTimeoutMs = 50) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolPolicyService, {})
  if (adapter !== undefined) ctx.llm.registerAdapter(['intent', 'primary', 'secondary'], adapter)
  apply(ctx, makeConfig(decisionTimeoutMs))
  return ctx
}

function evaluate(ctx: Context, agent: Agent, signal = new AbortController().signal) {
  return ctx.toolPolicy.evaluate({
    callId: CallId('c'), toolName: 'bash', arguments: { command: 'system_profiler SPSoftwareDataType', description: 'inspect' }, agent, signal,
  })
}

async function prewarm(ctx: Context, agent: Agent): Promise<void> {
  await ctx.toolPolicy.prewarm({ session: agent.session, signal: new AbortController().signal })
}

describe('shell classifier dispatch', () => {
  it('prewarms user intent and hands its short context to one tool-time effect review', async () => {
    const adapter = new RoutedAdapter({ intent: [INTENT_ALLOW], primary: [EFFECT_ALLOW] }, 5)
    const ctx = await setup(adapter)
    const { agent, events } = fakeAgent()
    await prewarm(ctx, agent)
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow', risk: 5 })
    expect(adapter.maxActive).toBe(1)
    expect(adapter.seen).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'intent', model: 'i-model', reasoningEffort: 'minimal', temperature: 0, maxTokens: 80,
      }),
      expect.objectContaining({ provider: 'primary', model: 'p-model', temperature: 0, maxTokens: 80 }),
    ]))
    const requests = events.filter(event => event.type === 'tool-policy/classifier-request')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.data).toMatchObject({
      purpose: 'intent-context', route: { reasoningEffort: 'minimal' },
      input: { kind: 'intent-context', userMessageSeqs: [2], maxUserMessageChars: 100 },
      request: { timeoutMs: 50 },
    })
    expect(requests[1]?.data).toMatchObject({
      purpose: 'effect-primary', input: {
        kind: 'effect', commandArgument: 'command', intentArgument: 'description', maxCommandChars: 1_000, maxIntentChars: 100,
      },
    })
    expect(JSON.stringify(requests[0]?.data))
      .toContain('Line 1 is comma-separated allowed effects or -. Line 2 is comma-separated explicitly forbidden effects or -.')
    expect(JSON.stringify(requests[0]?.data)).toContain('the response begins exactly with -\\n-\\n')
    expect(JSON.stringify(requests[1]?.data))
      .toContain('only for a path explicitly named or derived by the command that resolves outside cwd')
    expect(events.filter(event => event.type === 'tool-policy/intent-context')).toHaveLength(1)
    expect(JSON.stringify(requests)).not.toContain('inspect it')
    expect(JSON.stringify(requests)).not.toContain('system_profiler SPSoftwareDataType')
  })

  it('uses the secondary effect route only when the primary result is invalid', async () => {
    const adapter = new RoutedAdapter({
      intent: [INTENT_ALLOW],
      primary: ['aligned;host-read;extra'],
      secondary: [EFFECT_ALLOW],
    })
    const ctx = await setup(adapter)
    const { agent } = fakeAgent()
    await prewarm(ctx, agent)
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow', risk: 5 })
    expect(adapter.seen.map(item => item.provider)).toEqual(expect.arrayContaining(['intent', 'primary', 'secondary']))
  })

  it('accepts one whole-response text fence and rejects commentary around it', async () => {
    const fenced = await setup(new RoutedAdapter({
      intent: [`\`\`\`text\n${INTENT_ALLOW}\n\`\`\``],
      primary: [`\`\`\`text\n${EFFECT_ALLOW}\n\`\`\``],
    }))
    const fencedAgent = fakeAgent().agent
    await prewarm(fenced, fencedAgent)
    await expect(evaluate(fenced, fencedAgent)).resolves.toMatchObject({ decision: 'allow' })

    const commentary = await setup(new RoutedAdapter({
      intent: [`Here is the result:\n\`\`\`text\n${INTENT_ALLOW}\n\`\`\``],
      primary: [EFFECT_ALLOW],
    }))
    const commentaryAgent = fakeAgent().agent
    await prewarm(commentary, commentaryAgent)
    const verdict = await evaluate(commentary, commentaryAgent)
    expect(verdict?.decision).toBe('ask')
    expect(verdict?.categories).toContain('invalid-output')
  })

  it('accepts an exact closed JSON object when a route ignores the compact protocol', async () => {
    const ctx = await setup(new RoutedAdapter({
      intent: ['{"allowedEffects":["host-read","credential-access"],"forbiddenEffects":[],"summary":"inspect system information"}'],
      primary: ['{"alignment":"aligned","effects":["host-read"]}'],
    }))
    const agent = fakeAgent().agent
    await prewarm(ctx, agent)
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow' })
  })

  it('accepts Gemini joining the compact alignment and effect fields with commas', async () => {
    const ctx = await setup(new RoutedAdapter({ intent: [INTENT_ALLOW], primary: ['aligned,host-read'] }))
    const agent = fakeAgent().agent
    await prewarm(ctx, agent)
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow' })
  })

  it('does not use secondary evidence to override a validated sensitive effect', async () => {
    const adapter = new RoutedAdapter({
      intent: [INTENT_ALLOW],
      primary: ['aligned;network-read'],
      secondary: [EFFECT_ALLOW],
    })
    const ctx = await setup(adapter)
    const { agent } = fakeAgent()
    await prewarm(ctx, agent)
    const verdict = await evaluate(ctx, agent)
    expect(verdict?.decision).toBe('ask')
    expect(verdict?.categories).toContain('network-read')
    expect(adapter.seen.some(item => item.provider === 'secondary')).toBe(false)
  })

  it('fails closed when intent evidence or every effect route is unavailable', async () => {
    const unavailable = await setup()
    const first = fakeAgent()
    await expect(evaluate(unavailable, first.agent)).resolves.toMatchObject({
      decision: 'ask', reason: 'independent intent context is unavailable',
    })

    const malformed = await setup(new RoutedAdapter({ intent: [INTENT_ALLOW], primary: ['bad'], secondary: ['bad'] }))
    const second = fakeAgent()
    await prewarm(malformed, second.agent)
    await expect(evaluate(malformed, second.agent)).resolves.toMatchObject({
      decision: 'ask', reason: 'independent authorization evidence is unavailable',
    })
  })

  it('does not send an auxiliary request to the acting model route', async () => {
    const adapter = new RoutedAdapter({ intent: [INTENT_ALLOW], secondary: [EFFECT_ALLOW] })
    const ctx = await setup(adapter)
    const { agent } = fakeAgent({ provider: 'primary', model: 'p-model' })
    await prewarm(ctx, agent)
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow' })
    expect(adapter.seen.map(item => item.provider)).toEqual(expect.arrayContaining(['intent', 'secondary']))
    expect(adapter.seen.some(item => item.provider === 'primary')).toBe(false)
  })

  it('shares concurrent exact auxiliary inputs', async () => {
    const adapter = new RoutedAdapter({ intent: [INTENT_ALLOW], primary: [EFFECT_ALLOW] }, 5)
    const ctx = await setup(adapter)
    const { agent } = fakeAgent()
    await Promise.all([prewarm(ctx, agent), prewarm(ctx, agent)])
    await Promise.all([evaluate(ctx, agent), evaluate(ctx, agent)])
    expect(adapter.seen).toHaveLength(2)
  })

  it('retries intent preparation after a failed prewarm', async () => {
    const adapter = new RoutedAdapter({ intent: ['invalid', INTENT_ALLOW], primary: [EFFECT_ALLOW] })
    const ctx = await setup(adapter)
    const { agent } = fakeAgent()
    await prewarm(ctx, agent)
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'allow' })
    expect(adapter.seen.map(item => item.provider)).toEqual(['intent', 'intent', 'primary'])
  })

  it('records late intent context in the turn that requested it', async () => {
    const ctx = await setup(new RoutedAdapter({ intent: [INTENT_ALLOW] }, 5))
    const { agent, events } = fakeAgent()
    const pending = prewarm(ctx, agent)
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await pending
    expect(events.find(event => event.type === 'tool-policy/intent-context')?.data).toMatchObject({ turn: 1 })
  })

  it('preserves caller cancellation', async () => {
    class WaitingAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (options.provider === 'intent') {
          yield { type: 'text-delta', index: 0, text: INTENT_ALLOW }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        if (!options.signal?.aborted) {
          await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => { resolve() }, { once: true }))
        }
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      }
    }
    const ctx = await setup(new WaitingAdapter())
    const { agent } = fakeAgent()
    await prewarm(ctx, agent)
    const controller = new AbortController()
    const pending = evaluate(ctx, agent, controller.signal)
    const reason = new Error('caller stopped')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('fails closed when the shared decision deadline wins', async () => {
    class WaitingAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (options.provider === 'intent') {
          yield { type: 'text-delta', index: 0, text: INTENT_ALLOW }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => { resolve() }, { once: true }))
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      }
    }
    const ctx = await setup(new WaitingAdapter(), 1)
    const { agent } = fakeAgent()
    await prewarm(ctx, agent)
    const verdict = await evaluate(ctx, agent)
    expect(verdict?.decision).toBe('ask')
    expect(verdict?.categories).toContain('unavailable')
  })

  it('does not restart the decision deadline for secondary effect review', async () => {
    class FallbackAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (options.provider === 'primary') {
          await new Promise(resolve => setTimeout(resolve, 30))
          yield { type: 'text-delta', index: 0, text: 'invalid' }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        if (options.provider === 'secondary') {
          await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => { resolve() }, { once: true }))
          yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
          return
        }
        yield { type: 'text-delta', index: 0, text: INTENT_ALLOW }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const ctx = await setup(new FallbackAdapter(), 50)
    const agent = fakeAgent().agent
    await prewarm(ctx, agent)
    const started = performance.now()
    await expect(evaluate(ctx, agent)).resolves.toMatchObject({ decision: 'ask' })
    expect(performance.now() - started).toBeLessThan(70)
  })

  it('allows the two blinded reviews to share a route but rejects a matching effect fallback', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ToolPolicyService, {})
    expect(() => { apply(ctx, makeConfig(50, { provider: 'primary', model: 'p-model' })) }).not.toThrow()
    const config = Object.assign({}, makeConfig(), { secondary: { provider: 'primary', model: 'p-model' } })
    expect(() => { apply(ctx, config) }).toThrow(/distinct routes/)
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
