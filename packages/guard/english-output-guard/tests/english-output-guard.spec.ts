import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ToolCallId,
  expandAssistantStream,
  type ReplayEnvelope,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as EnglishOutputGuard from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const config = (failureMode: 'preserve' | 'block' = 'block'): EnglishOutputGuard.Config => ({
  targets: [{ provider: 'main', model: 'selected' }],
  translator: { provider: 'translator', model: 'english' },
  hanMinChars: 2,
  hanRatio: 0.2,
  maxTranslationInputChars: 10_000,
  maxOutputTokens: 500,
  timeoutMs: 1_000,
  failureMode,
  translationNotice: 'none',
})

function response(blocks: Array<{ type: 'text' | 'reasoning'; text: string }>, replayState: ReplayEnvelope | undefined = { response: { cursor: 'opaque' } }): StreamChunk[] {
  const chunks: StreamChunk[] = []
  blocks.forEach((block, index) => {
    chunks.push({ type: 'block-start', index, blockType: block.type })
    chunks.push(block.type === 'text'
      ? { type: 'text-delta', index, text: block.text }
      : { type: 'reasoning-delta', index, text: block.text })
    chunks.push({ type: 'block-end', index, block })
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 7, outputTokens: 9, cacheReadTokens: 3 } })
  chunks.push({ type: 'finish', reason: { kind: 'stop' }, replayState })
  return chunks
}

class RoutedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly translationStarted: Promise<void>
  private mainCalls = 0
  private startTranslation!: () => void

  constructor(
    private readonly main: StreamChunk[],
    private readonly translation: StreamChunk[] | 'error' | 'hang',
  ) {
    super()
    this.translationStarted = new Promise((resolve) => { this.startTranslation = resolve })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.provider === 'main') {
      this.mainCalls++
      if (this.mainCalls > 1) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SCRIPT_END', message: 'main script exhausted' } } }
        return
      }
      yield* this.main
      return
    }
    this.startTranslation()
    if (this.translation === 'error') throw new Error('translator unavailable')
    if (this.translation === 'hang') {
      await new Promise<void>((_resolve, reject) => {
        const abort = (): void => { reject(new Error('aborted')) }
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
      return
    }
    yield* this.translation
  }
}

function nextIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

async function run(
  main: StreamChunk[],
  translation: StreamChunk[] | 'error' | 'hang',
  guardConfig = config(),
  route = { provider: 'main', model: 'selected' },
): Promise<{ agent: Agent; adapter: RoutedAdapter; ctx: Context }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(EnglishOutputGuard, guardConfig)
  const adapter = new RoutedAdapter(main, translation)
  ctx.llm.registerAdapter(['main', 'translator'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), route)
  const idle = nextIdle(ctx, agent)
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }))
  await idle
  return { agent, adapter, ctx }
}

function assistant(agent: Agent) {
  return agent.session.snapshotEvents().findLast(event => event.type === 'assistant/message')
}

function recordedChunks(agent: Agent): StreamChunk[] {
  return agent.session.snapshotEvents().flatMap(event =>
    event.type === 'assistant/message' || event.type === 'assistant/attempt'
      ? expandAssistantStream(event.data.stream).map(entry => entry.chunk) : [])
}

describe('targeting and replay', () => {
  it('immediately passes a target-looking non-loop request through', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EnglishOutputGuard, config())
    const original = response([{ type: 'text', text: '中文回答' }])
    const adapter = new RoutedAdapter(original, 'error')
    ctx.llm.registerAdapter(['main', 'translator'], adapter)
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'main', model: 'selected', messages: [] })) chunks.push(chunk)
    expect(chunks).toEqual(original)
    expect(adapter.requests).toHaveLength(1)
  })

  it('replays a no-drift stream byte-for-byte, including replay state', async () => {
    const original = response([{ type: 'text', text: 'English only.' }])
    const { agent, adapter } = await run(original, response([{ type: 'text', text: 'unused' }]))
    const chunks = recordedChunks(agent)
    expect(chunks).toEqual(original)
    expect(adapter.requests).toHaveLength(1)
    expect(assistant(agent)?.data.message.source.replayState).toEqual({ response: { cursor: 'opaque' } })
  })

  it('passes a non-target loop request through without translator dispatch', async () => {
    const original = response([{ type: 'text', text: '中文回答' }])
    const { agent, adapter } = await run(original, response([{ type: 'text', text: 'unused' }]), config(), { provider: 'main', model: 'other' })
    expect(adapter.requests).toHaveLength(1)
    expect(assistant(agent)?.data.message.content).toEqual([{ type: 'text', text: '中文回答' }])
  })

  it.each(['error', 'aborted'] as const)('replays a main %s finish without translating', async (kind) => {
    const original: StreamChunk[] = [
      { type: 'block-start', index: 4, blockType: 'text' },
      { type: 'text-delta', index: 4, text: '中文 partial' },
      { type: 'finish', reason: { kind, failure: { code: kind.toUpperCase(), message: kind } } },
    ]
    const { agent, adapter } = await run(original, 'error')
    expect(recordedChunks(agent)).toEqual(original)
    expect(adapter.requests).toHaveLength(1)
    expect(assistant(agent)).toBeUndefined()
  })
})

describe('translation', () => {
  it('translates text and reasoning while preserving code, paths, URLs, order, usage, and finish', async () => {
    const main = response([
      { type: 'reasoning', text: '需要检查 `/tmp/中文.ts`.' },
      { type: 'text', text: '这是答案. See https://example.test/中文.' },
    ])
    const translated = JSON.stringify({ translations: [
      { index: 0, type: 'reasoning', text: 'We need to inspect __DSH_PROTECTED_0__.' },
      { index: 1, type: 'text', text: 'This is the answer. See __DSH_PROTECTED_0__.' },
    ] })
    const { agent, adapter } = await run(main, response([{ type: 'text', text: translated }], undefined))
    const event = assistant(agent)
    expect(event?.data.message.content).toEqual([
      { type: 'reasoning', text: 'We need to inspect `/tmp/中文.ts`.' },
      { type: 'text', text: 'This is the answer. See https://example.test/中文.' },
    ])
    expect(event?.data.usage).toEqual({ inputTokens: 7, outputTokens: 9, cacheReadTokens: 3 })
    expect(event?.data.message.source.replayState).toBeUndefined()
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.provider).toBe('translator')
    expect(adapter.requests[1]?.maxTokens).toBe(500)
    expect(adapter.requests[1]?.system).toContain('untrusted DATA')
    const audit = agent.session.snapshotEvents().filter(event => event.type.startsWith('english-output/'))
    expect(audit.map(event => event.type)).toEqual(['english-output/translation-request', 'english-output/translation-result'])
    const requestEvent = agent.session.snapshotEvents().find(event => event.type === 'english-output/translation-request')
    expect(requestEvent?.data.messages).toEqual(adapter.requests[1]?.messages)
    expect(requestEvent?.data.system).toBe(adapter.requests[1]?.system)
    expect(requestEvent?.data.blocks).toEqual([
      { index: 0, type: 'reasoning', content: '需要检查 `/tmp/中文.ts`.' },
      { index: 1, type: 'text', content: '这是答案. See https://example.test/中文.' },
    ])
    expect(audit[1]?.data).toMatchObject({ status: 'translated', blockIndexes: [0, 1] })
  })

  it('preserves sparse provider block indexes in the synthesized stream', async () => {
    const main: StreamChunk[] = [
      { type: 'block-start', index: 7, blockType: 'text' },
      { type: 'text-delta', index: 7, text: '中文回答' },
      { type: 'block-end', index: 7, block: { type: 'text', text: '中文回答' } },
      { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { opaque: true } } },
    ]
    const translated = JSON.stringify({ translations: [{ index: 7, type: 'text', text: 'English answer' }] })
    const { agent } = await run(main, response([{ type: 'text', text: translated }], undefined))
    const chunks = recordedChunks(agent)
    expect(chunks.slice(0, 3).every(chunk => 'index' in chunk && chunk.index === 7)).toBe(true)
  })

  it('prevents recursion when translator and target use the same exact route', async () => {
    class SameRouteAdapter extends LlmAdapter {
      calls = 0
      override async * stream(): AsyncIterable<StreamChunk> {
        this.calls++
        if (this.calls > 2) throw new Error('recursive translation')
        const text = this.calls === 1
          ? '中文回答'
          : '{"translations":[{"index":0,"type":"text","text":"English answer"}]}'
        yield* response([{ type: 'text', text }], undefined)
      }
    }
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const local = config()
    local.targets = [{ provider: 'same', model: 'same' }]
    local.translator = { provider: 'same', model: 'same' }
    await ctx.plugin(EnglishOutputGuard, local)
    const adapter = new SameRouteAdapter()
    ctx.llm.registerAdapter(['same'], adapter)
    const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'same', model: 'same' })
    const idle = nextIdle(ctx, agent)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }))
    await idle
    expect(adapter.calls).toBe(2)
    expect(assistant(agent)?.data.message.content).toEqual([{ type: 'text', text: 'English answer' }])
  })

  it('keeps tool calls structured when blocking invalid translator output', async () => {
    const callId = ToolCallId('call-1')
    const main: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '中文回答' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '中文回答' } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: callId, name: 'missing', argumentsDelta: '{"path":"/tmp/中文"}' },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: callId, name: 'missing', arguments: '{"path":"/tmp/中文"}' } },
      { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { secret: true } } },
    ]
    const { agent } = await run(main, response([{ type: 'text', text: '{not json' }], undefined))
    const chunks = recordedChunks(agent)
    expect(chunks).toContainEqual({ type: 'tool-call-delta', index: 1, id: callId, name: 'missing', argumentsDelta: '{"path":"/tmp/中文"}' })
    expect(chunks).toContainEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('withheld'))).toBe(true)
  })
})

describe('failure policy', () => {
  it.each([
    ['preserve', 'error'] as const,
    ['preserve', 'hang'] as const,
  ])('%s replays original prose after translator %s', async (mode, translator) => {
    const original = response([{ type: 'text', text: '中文回答' }])
    const local = config(mode)
    if (translator === 'hang') local.timeoutMs = 5
    const { agent } = await run(original, translator, local)
    const chunks = recordedChunks(agent)
    expect(chunks).toEqual(original)
    expect(assistant(agent)?.data.message.content).toEqual([{ type: 'text', text: '中文回答' }])
    const result = agent.session.snapshotEvents().find(event => event.type === 'english-output/translation-result')
    expect(result?.data.status).toBe('preserved')
  })

  it('block replaces affected prose after a provider failure', async () => {
    const { agent } = await run(response([{ type: 'text', text: '中文回答' }]), 'error')
    expect(assistant(agent)?.data.message.content).toEqual([{
      type: 'text',
      text: 'English output enforcement failed. The non-English prose was withheld.',
    }])
    const result = agent.session.snapshotEvents().find(event => event.type === 'english-output/translation-result')
    expect(result?.data).toMatchObject({ status: 'blocked', failure: { code: 'provider-error' } })
  })

  it('rejects remaining unprotected Han and duplicate placeholders', async () => {
    const main = response([{ type: 'text', text: '中文 `/tmp/中文`' }])
    const invalid = [
      JSON.stringify({ translations: [{ index: 0, type: 'text', text: '仍有中文 __DSH_PROTECTED_0__' }] }),
      JSON.stringify({ translations: [{ index: 0, type: 'text', text: '__DSH_PROTECTED_0__ __DSH_PROTECTED_0__' }] }),
    ]
    for (const translated of invalid) {
      const { agent } = await run(main, response([{ type: 'text', text: translated }], undefined))
      const result = agent.session.snapshotEvents().find(event => event.type === 'english-output/translation-result')
      expect(result?.data).toMatchObject({ status: 'blocked', failure: { code: 'invalid-output' } })
    }
  })

  it('enforces the serialized input limit before translator dispatch', async () => {
    const local = config('preserve')
    local.maxTranslationInputChars = 1
    const original = response([{ type: 'text', text: '中文回答' }])
    const { agent, adapter } = await run(original, 'error', local)
    expect(adapter.requests).toHaveLength(1)
    const result = agent.session.snapshotEvents().find(event => event.type === 'english-output/translation-result')
    expect(result?.data).toMatchObject({ status: 'preserved', failure: { code: 'input-too-large' } })
  })

  it('aborts and awaits an active translator when its plugin fiber disposes', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const local = config('preserve')
    local.timeoutMs = 60_000
    const fiber = ctx.plugin(EnglishOutputGuard, local)
    await fiber
    const adapter = new RoutedAdapter(response([{ type: 'text', text: '中文回答' }]), 'hang')
    ctx.llm.registerAdapter(['main', 'translator'], adapter)
    const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'main', model: 'selected' })
    const idle = nextIdle(ctx, agent)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }))
    await adapter.translationStarted
    await fiber.dispose()
    await idle
    const result = agent.session.snapshotEvents().find(event => event.type === 'english-output/translation-result')
    expect(result?.data).toMatchObject({ status: 'preserved', failure: { code: 'cancelled' } })
  })
})
