import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import ToolPolicyService from '@deepseek-ai/dsh-tool-policy'
import { describe, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.ts'
import * as shellPlugin from '../src/index.ts'

class QueueAdapter extends LlmAdapter {
  readonly seen: GenerateOptions[] = []
  constructor(private readonly outputs: string[]) { super() }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options)
    const text = this.outputs.shift() ?? 'not-json'
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function makeConfig(timeoutMs = 50): Config {
  return {
    id: 'shell',
    mappings: [{ tool: 'bash', commandArgument: 'command', intentArgument: 'description' }],
    primary: { provider: 'primary', model: 'p-model' },
    secondary: { provider: 'secondary', model: 's-model' },
    timeoutMs,
    maxTokens: 80,
    maxCommandChars: 1_000,
    maxUserMessageChars: 100,
    maxIntentChars: 100,
    maxOutputChars: 1_000,
    maxReasonChars: 80,
    maxCategories: 4,
    maxCategoryChars: 20,
    rules: [],
  }
}

function fakeAgent() {
  const events: Array<Record<string, unknown>> = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'inspect it' }] } },
    { type: 'tool/call', data: { callId: CallId('c'), name: 'bash', arguments: '{}' } },
  ]
  const session = {
    id: 'session',
    header: { id: 'session', cwd: '/work' },
    events,
    append(type: string, data: unknown) { const event = { type, data }; events.push(event); return event },
  }
  return { agent: { session } as unknown as Agent, events }
}

async function setup(adapter?: LlmAdapter, timeoutMs = 50) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolPolicyService, {})
  if (adapter !== undefined) ctx.llm.registerAdapter(['primary', 'secondary'], adapter)
  apply(ctx, makeConfig(timeoutMs))
  return ctx
}

describe('shell classifier dispatch', () => {
  it('logs the exact bounded request and accepts strict output', async () => {
    const adapter = new QueueAdapter(['{"decision":"allow","risk":10,"categories":["read"],"reason":"ok"}'])
    const ctx = await setup(adapter)
    const { agent, events } = fakeAgent()
    const result = await ctx.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'uname -a', description: 'inspect' },
      agent, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ decision: 'allow', risk: 10 })
    expect(adapter.seen[0]).toMatchObject({ provider: 'primary', model: 'p-model', temperature: 0, maxTokens: 80 })
    expect(events.find(event => event.type === 'tool-policy/classifier-request')).toMatchObject({
      data: { route: { provider: 'primary', model: 'p-model' }, request: { temperature: 0, maxTokens: 80 } },
    })
  })

  it('fails closed for malformed output and unavailable adapters', async () => {
    const malformed = await setup(new QueueAdapter(['{"decision":"allow","risk":0,"categories":[],"reason":"x","extra":true}']))
    const first = fakeAgent()
    await expect(malformed.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'uname -a' },
      agent: first.agent, signal: new AbortController().signal,
    })).resolves.toMatchObject({ decision: 'ask', categories: ['invalid-output'] })

    const unavailable = await setup()
    const second = fakeAgent()
    await expect(unavailable.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'uname -a' },
      agent: second.agent, signal: new AbortController().signal,
    })).resolves.toMatchObject({ decision: 'ask', categories: ['unavailable'] })
  })

  it('preserves caller cancellation', async () => {
    class WaitingAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (!options.signal?.aborted) {
          await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => {
            resolve()
          }, { once: true }))
        }
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      }
    }
    const ctx = await setup(new WaitingAdapter())
    const { agent } = fakeAgent()
    const controller = new AbortController()
    const pending = ctx.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'uname -a' }, agent, signal: controller.signal,
    })
    const reason = new Error('caller stopped')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('fails closed when the classifier timeout wins', async () => {
    class WaitingAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => {
          resolve()
        }, { once: true }))
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      }
    }
    const ctx = await setup(new WaitingAdapter(), 1)
    const { agent } = fakeAgent()
    await expect(ctx.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'uname -a' },
      agent, signal: new AbortController().signal,
    })).resolves.toMatchObject({ decision: 'ask', reason: 'classifier timed out' })
  })

  it('removes its provider registration on plugin disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ToolPolicyService, {})
    const fiber = ctx.plugin(shellPlugin, makeConfig())
    await fiber
    const { agent } = fakeAgent()
    await expect(ctx.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'pwd' },
      agent, signal: new AbortController().signal,
    })).resolves.toMatchObject({ decision: 'allow' })
    await fiber.dispose()
    await expect(ctx.toolPolicy.evaluate({
      callId: CallId('c'), toolName: 'bash', arguments: { command: 'pwd' },
      agent, signal: new AbortController().signal,
    })).rejects.toThrow(/no providers are registered/)
  })
})
