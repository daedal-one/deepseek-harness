import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  createMessage, createToolResultMessage, LlmAdapter, ReasoningEffortId, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as activitySummary from '../src/index.ts'

abstract class OffReasoningAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string) {
    const off = ReasoningEffortId('off')
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: off, name: 'Off' }], defaultEffort: off },
    })
  }
}

class ScriptedAdapter extends OffReasoningAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly replies: readonly string[]) { super() }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = this.replies[this.requests.length - 1]
    if (text === undefined) throw new Error('missing scripted activity summary')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class CooperativeAdapter extends OffReasoningAdapter {
  readonly started = Promise.withResolvers<GenerateOptions>()

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.started.resolve(options)
    const signal = options.signal
    if (signal === undefined) throw new Error('expected activity-summary signal')
    await new Promise<never>((_resolve, reject) => {
      const rejectAbort = (): void => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      }
      if (signal.aborted) rejectAbort()
      else signal.addEventListener('abort', rejectAbort, { once: true })
    })
  }
}

const CONFIG = {
  operationsPerSummary: 5,
  maxOperationBytes: 2_048,
  maxInputBytes: 16_384,
  maxOutputTokens: 160,
  maxSummaryBytes: 720,
  maxLines: 3,
  timeoutMs: 1_000,
  provider: 'summary-route',
  model: 'summary-model',
} as const

const contexts: Context[] = []
let nextSession = 0

async function setupAdapter<Adapter extends LlmAdapter>(adapter: Adapter): Promise<{
  readonly ctx: Context
  readonly adapter: Adapter
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['summary-route'], adapter)
  activitySummary.apply(ctx, CONFIG)
  return { ctx, adapter }
}

async function setup(replies: readonly string[]): Promise<{
  readonly ctx: Context
  readonly adapter: ScriptedAdapter
}> {
  return setupAdapter(new ScriptedAdapter(replies))
}

function appendTool(
  ctx: Context,
  index: number,
  output = `result-${index}`,
): number {
  const session = ctx.sessions.get(SessionId(`activity-${nextSession}`))
  if (session === undefined) throw new Error('activity test session is unavailable')
  const callId = ToolCallId(`call-${index}`)
  session.append('tool/call', {
    turn: 1,
    step: index,
    callId,
    name: index % 2 === 0 ? 'subagent_worker' : 'bash',
    arguments: JSON.stringify({ task: `operation-${index}` }),
  })
  return session.append('tool/result', {
    turn: 1,
    step: index,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: output }],
      isError: false,
    }),
  }, { surfaceOp: 'append' }).seq
}

function createSession(ctx: Context) {
  const id = SessionId(`activity-${++nextSession}`)
  const session = ctx.sessions.create(id)
  session.append('turn/start', { turn: 1 })
  return session
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('live activity summaries', () => {
  it('dispatches after five completed operations and records the exact accepted update', async () => {
    const { ctx, adapter } = await setup(['Repository inspected\nFocused tests are running'])
    const session = createSession(ctx)
    for (let index = 1; index <= 4; index++) appendTool(ctx, index)
    expect(adapter.requests).toEqual([])
    const throughSeq = appendTool(ctx, 5)

    await vi.waitFor(() => {
      expect(session.snapshotEvents().filter(event => event.type === 'activity-summary/update')).toHaveLength(1)
    })
    expect(adapter.requests).toHaveLength(1)
    const options = adapter.requests[0]!
    expect(options).toMatchObject({
      provider: 'summary-route',
      model: 'summary-model',
      maxTokens: 160,
      reasoningEffort: 'off',
      sessionId: session.id,
      purpose: 'activity-summary',
    })
    const prompt = options.messages[0]?.content[0]
    expect(prompt?.type === 'text' && prompt.text).toContain('operation-1')
    const request = session.snapshotEvents().find(event => event.type === 'activity-summary/request')
    expect(request?.data).toMatchObject({
      turn: 1,
      revision: 1,
      route: { provider: 'summary-route', model: 'summary-model' },
      system: options.system,
      messages: options.messages,
      maxTokens: 160,
      reasoningEffort: 'off',
    })
    const update = session.snapshotEvents().find(event => event.type === 'activity-summary/update')
    expect(update?.data).toMatchObject({
      turn: 1,
      revision: 1,
      throughSeq,
      lines: ['Repository inspected', 'Focused tests are running'],
      route: { provider: 'summary-route', model: 'summary-model' },
    })
    expect(update?.data.operationSeqs).toHaveLength(5)
  })

  it('does not disclose reasoning text and carries the prior accepted lines into the next revision', async () => {
    const { ctx, adapter } = await setup(['First status', 'Updated status'])
    const session = createSession(ctx)
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'private chain of thought' },
          { type: 'text', text: 'Visible commentary stays in Chat.' },
        ],
        source: { kind: 'model', provider: 'primary', model: 'agent' },
      }),
    }, { surfaceOp: 'append' })
    for (let index = 1; index <= 4; index++) appendTool(ctx, index)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const firstPrompt = adapter.requests[0]?.messages[0]?.content[0]
    expect(firstPrompt?.type === 'text' && firstPrompt.text).not.toContain('private chain of thought')
    expect(firstPrompt?.type === 'text' && firstPrompt.text).toContain('Visible commentary stays in Chat.')

    for (let index = 5; index <= 9; index++) appendTool(ctx, index)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const secondPrompt = adapter.requests[1]?.messages[0]?.content[0]
    expect(secondPrompt?.type === 'text' && secondPrompt.text).toContain('"previousLines":["First status"]')
    await vi.waitFor(() => {
      expect(session.snapshotEvents().filter(event => event.type === 'activity-summary/update')).toHaveLength(2)
    })
    expect(session.snapshotEvents().findLast(event => event.type === 'activity-summary/update')?.data)
      .toMatchObject({ revision: 2, lines: ['Updated status'] })
  })

  it('summarizes a final four-operation tail and leaves the raw trace on invalid model output', async () => {
    const completed = await setup(['Final partial batch'])
    const completedSession = createSession(completed.ctx)
    for (let index = 1; index <= 4; index++) appendTool(completed.ctx, index)
    completedSession.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => {
      expect(completedSession.snapshotEvents().some(event => event.type === 'activity-summary/update')).toBe(true)
    })

    const failed = await setup(['one\ntwo\nthree\nfour', 'must not dispatch'])
    const failedSession = createSession(failed.ctx)
    for (let index = 1; index <= 5; index++) appendTool(failed.ctx, index)
    await vi.waitFor(() => { expect(failed.adapter.requests).toHaveLength(1) })
    await vi.waitFor(() => {
      expect(failedSession.snapshotEvents().some(event => event.type === 'activity-summary/request')).toBe(true)
    })
    for (let index = 6; index <= 10; index++) appendTool(failed.ctx, index)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(failed.adapter.requests).toHaveLength(1)
    expect(failedSession.snapshotEvents().some(event => event.type === 'activity-summary/update')).toBe(false)
    expect(failedSession.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(10)
  })

  it('aborts and joins the one owned request during plugin disposal', async () => {
    const adapter = new CooperativeAdapter()
    const { ctx } = await setupAdapter(adapter)
    const session = createSession(ctx)
    for (let index = 1; index <= 5; index++) appendTool(ctx, index)
    const options = await adapter.started.promise
    expect(options.signal?.aborted).toBe(false)

    await ctx.fiber.dispose()

    expect(options.signal?.aborted).toBe(true)
    expect(session.snapshotEvents().some(event => event.type === 'activity-summary/request')).toBe(true)
    expect(session.snapshotEvents().some(event => event.type === 'activity-summary/update')).toBe(false)
  })

  it('drops a queued batch when a newer Turn starts before dispatch', async () => {
    const { ctx, adapter } = await setup(['stale'])
    const session = createSession(ctx)
    for (let index = 1; index <= 5; index++) appendTool(ctx, index)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })

    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(adapter.requests).toEqual([])
    expect(session.snapshotEvents().some(event => event.type === 'activity-summary/request')).toBe(false)
  })
})
