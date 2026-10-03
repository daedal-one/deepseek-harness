import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime, {
  createMessage, createUserMessage, LlmAdapter, ReasoningEffortId, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as conversationSummary from '../src/index.ts'
import {
  collectTurnEntries, foldSessionSummary, frameSummaryInput, normalizeSessionSummary,
  summaryProjectionDefinition, truncateSummaryUtf8,
} from '../src/index.ts'

const CONFIG = {
  targetSentences: 3,
  maxEntryBytes: 512,
  maxInputBytes: 16_384,
  maxOutputTokens: 128,
  maxSummaryBytes: 720,
  timeoutMs: 1_000,
  provider: 'summary-route',
  model: 'summary-model',
} as const

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

/** Yields one scripted chunk sequence per request, in call order. */
class ScriptedAdapter extends OffReasoningAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly scripts: readonly (readonly StreamChunk[])[]) { super() }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const script = this.scripts[this.requests.length - 1]
    if (script === undefined) throw new Error('missing scripted conversation summary')
    for (const chunk of script) yield chunk
  }
}

/** Holds the request open until its composed deadline aborts. */
class CooperativeAdapter extends OffReasoningAdapter {
  readonly started = Promise.withResolvers<GenerateOptions>()

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.started.resolve(options)
    const signal = options.signal
    if (signal === undefined) throw new Error('expected conversation-summary signal')
    await new Promise<never>((_resolve, reject) => {
      const rejectAbort = (): void => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      }
      if (signal.aborted) rejectAbort()
      else signal.addEventListener('abort', rejectAbort, { once: true })
    })
  }
}

/** Answers after a delay and ignores cancellation, holding the plugin's join open. */
class DelayedAdapter extends OffReasoningAdapter {
  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await new Promise<void>(resolve => setTimeout(resolve, 30))
    for (const chunk of textScript('ignored after disposal')) yield chunk
  }
}

/** One text reply that finished normally. */
function textScript(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One reasoning-only reply: a non-text block that must be rejected. */
function reasoningScript(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One reply that ends with the supplied terminal reason and no text. */
function finishScript(reason: StreamChunk & { type: 'finish' }): StreamChunk[] {
  return [reason]
}

const contexts: Context[] = []
let nextSession = 0

async function setupAdapter<Adapter extends LlmAdapter>(
  adapter: Adapter,
  config: conversationSummary.Config = CONFIG,
): Promise<{ readonly ctx: Context; readonly adapter: Adapter; readonly fiber: Fiber }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['summary-route'], adapter)
  const fiber = await ctx.plugin({
    name: conversationSummary.name,
    inject: [...conversationSummary.inject],
    apply: (inner: Context) => { conversationSummary.apply(inner, config) },
  })
  return { ctx, adapter, fiber }
}

async function setup(
  scripts: readonly (readonly StreamChunk[])[],
): Promise<{ readonly ctx: Context; readonly adapter: ScriptedAdapter; readonly fiber: Fiber }> {
  return setupAdapter(new ScriptedAdapter(scripts))
}

function createTurn(ctx: Context, turn = 1): Session {
  const session = ctx.sessions.create(SessionId(`summary-${++nextSession}`))
  session.append('turn/start', { turn })
  return session
}

function appendPrompt(session: Session, text: string): SessionSeq {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

function appendReply(session: Session, turn: number, text: string): SessionSeq {
  return session.append('assistant/message', {
    turn,
    step: 1,
    stream: [],
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'primary', model: 'agent' },
    }),
  }, { surfaceOp: 'append' }).seq
}

function appendToolCall(session: Session, turn: number, name = 'bash'): SessionSeq {
  return session.append('tool/call', {
    turn,
    step: 1,
    callId: ToolCallId(`call-${++nextSession}`),
    name,
    arguments: '{"command":"ls"}',
  }).seq
}

function endTurn(session: Session, turn: number): SessionSeq {
  return session.append('turn/end', { turn, reason: { kind: 'completed' } }).seq
}

function summaryEvents(session: Session): SessionEvent<'session/summary'>[] {
  return session.snapshotEvents()
    .filter((event): event is SessionEvent<'session/summary'> => event.type === 'session/summary')
}

function requestEvents(session: Session): SessionEvent<'session/summary-llm-request'>[] {
  return session.snapshotEvents()
    .filter((event): event is SessionEvent<'session/summary-llm-request'> => event.type === 'session/summary-llm-request')
}

function summaryText(ctx: Context, session: Session): string | null {
  return ctx.sessionProjections.snapshot(session).values.summary ?? null
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('durable conversation summaries', () => {
  it('records the exact request and accepted summary for one closed Turn', async () => {
    const { ctx, adapter } = await setup([textScript('The session adds a summary block and tests it.')])
    const session = createTurn(ctx)
    const promptSeq = appendPrompt(session, 'Add a conversation summary to the Info tab.')
    const replySeq = appendReply(session, 1, 'Implemented the summary block and its tests.')
    const toolSeq = appendToolCall(session, 1, 'bash')
    const turnEndSeq = endTurn(session, 1)

    await vi.waitFor(() => { expect(summaryEvents(session)).toHaveLength(1) })

    expect(adapter.requests).toHaveLength(1)
    const options = adapter.requests[0]!
    expect(options).toMatchObject({
      provider: 'summary-route',
      model: 'summary-model',
      maxTokens: 128,
      reasoningEffort: 'off',
      sessionId: session.id,
      purpose: 'session-summary',
    })
    const prompt = options.messages[0]?.content[0]
    expect(prompt?.type === 'text' && prompt.text).toContain('"kind":"prompt"')
    expect(prompt?.type === 'text' && prompt.text).toContain('"kind":"reply"')
    expect(prompt?.type === 'text' && prompt.text).toContain('"kind":"tool"')
    expect(prompt?.type === 'text' && prompt.text).toContain('bash')
    expect(prompt?.type === 'text' && prompt.text).toContain('"previousSummary":null')
    // Tool arguments never reach the request.
    expect(prompt?.type === 'text' && prompt.text).not.toContain('"command":"ls"')

    expect(requestEvents(session)[0]?.data).toMatchObject({
      turn: 1,
      revision: 1,
      sourceSeqs: [promptSeq, replySeq, toolSeq],
      route: { provider: 'summary-route', model: 'summary-model' },
      system: options.system,
      messages: options.messages,
      maxTokens: 128,
      reasoningEffort: 'off',
    })
    expect(summaryEvents(session)[0]?.data).toMatchObject({
      turn: 1,
      revision: 1,
      summary: 'The session adds a summary block and tests it.',
      sourceSeqs: [promptSeq, replySeq, toolSeq],
      throughSeq: turnEndSeq,
      route: { provider: 'summary-route', model: 'summary-model' },
    })
    expect(summaryText(ctx, session)).toBe('The session adds a summary block and tests it.')
  })

  it('carries the accepted summary into the next revision and advances the covered seq', async () => {
    const { ctx, adapter } = await setup([
      textScript('First revision text.'),
      textScript('Second revision text.'),
    ])
    const session = createTurn(ctx)
    appendPrompt(session, 'First prompt.')
    appendReply(session, 1, 'First reply.')
    const firstEnd = endTurn(session, 1)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    session.append('turn/start', { turn: 2 })
    appendPrompt(session, 'Second prompt.')
    const secondEnd = endTurn(session, 2)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })

    const secondPrompt = adapter.requests[1]?.messages[0]?.content[0]
    expect(secondPrompt?.type === 'text' && secondPrompt.text)
      .toContain('"previousSummary":"First revision text."')
    expect(secondPrompt?.type === 'text' && secondPrompt.text).not.toContain('First prompt.')
    const revisions = summaryEvents(session).map(event => event.data)
    expect(revisions.map(revision => revision.revision)).toEqual([1, 2])
    expect(revisions[1]?.throughSeq).toBe(secondEnd)
    expect(revisions[1]?.throughSeq).toBeGreaterThan(firstEnd)
    expect(summaryText(ctx, session)).toBe('Second revision text.')
  })

  it('publishes nothing for a Turn that contributes no collectible entries', async () => {
    const { ctx, adapter } = await setup([textScript('must not dispatch')])
    const session = createTurn(ctx)
    endTurn(session, 1)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(adapter.requests).toEqual([])
    expect(requestEvents(session)).toEqual([])
  })

  it('publishes nothing for a Turn that never started in this log', async () => {
    const { ctx, adapter } = await setup([textScript('must not dispatch')])
    const session = createTurn(ctx)
    appendPrompt(session, 'Present prompt.')
    endTurn(session, 99)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(adapter.requests).toEqual([])
  })

  it('skips injected context, empty text, non-matching Turns, and unrelated events', async () => {
    const { ctx, adapter } = await setup([textScript('Only the human prompt.')])
    const session = createTurn(ctx)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'injected plugin context' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '   ' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 99,
      step: 1,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'other turn reply' }],
        source: { kind: 'model', provider: 'primary', model: 'agent' },
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'hidden reasoning only' }],
        source: { kind: 'model', provider: 'primary', model: 'agent' },
      }),
    }, { surfaceOp: 'append' })
    appendToolCall(session, 99, 'other-turn-tool')
    appendPrompt(session, 'Human prompt only.')
    endTurn(session, 1)

    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const prompt = adapter.requests[0]?.messages[0]?.content[0]
    const text = prompt?.type === 'text' ? prompt.text : ''
    expect(text).toContain('Human prompt only.')
    expect(text).not.toContain('injected plugin context')
    expect(text).not.toContain('other turn reply')
    expect(text).not.toContain('hidden reasoning only')
    expect(text).not.toContain('other-turn-tool')
  })

  it('aborts an in-flight revision when a newer Turn starts', async () => {
    const adapter = new CooperativeAdapter()
    const { ctx } = await setupAdapter(adapter)
    const session = createTurn(ctx)
    appendPrompt(session, 'First prompt.')
    endTurn(session, 1)
    const options = await adapter.started.promise
    expect(options.signal?.aborted).toBe(false)

    session.append('turn/start', { turn: 2 })

    await vi.waitFor(() => { expect(options.signal?.aborted).toBe(true) })
    expect(summaryEvents(session)).toEqual([])
    expect(summaryText(ctx, session)).toBeNull()
  })

  it('supersedes an older Turn when its own Turn closes while one request is active', async () => {
    const adapter = new CooperativeAdapter()
    const { ctx, fiber } = await setupAdapter(adapter)
    const session = createTurn(ctx)
    appendPrompt(session, 'First prompt.')
    endTurn(session, 1)
    const options = await adapter.started.promise

    session.append('turn/start', { turn: 2 })
    appendPrompt(session, 'Second prompt.')
    endTurn(session, 2)

    await vi.waitFor(() => { expect(options.signal?.aborted).toBe(true) })
    // The superseded revision settles after a newer one owns the Session.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(requestEvents(session)).toHaveLength(2)
    await fiber.dispose()
  })

  it('starts nothing for a second close of the Turn already in flight', async () => {
    const adapter = new CooperativeAdapter()
    const { ctx } = await setupAdapter(adapter)
    const session = createTurn(ctx)
    appendPrompt(session, 'First prompt.')
    endTurn(session, 1)
    await adapter.started.promise

    endTurn(session, 1)

    await vi.waitFor(() => {
      expect(requestEvents(session)).toHaveLength(1)
    })
  })

  it('rejects empty, non-text, over-budget, and non-stop output while keeping the accepted summary', async () => {
    const { ctx, adapter } = await setup([
      textScript('Accepted summary text.'),
      textScript('   \n  '),
      reasoningScript('hidden'),
      textScript('x'.repeat(CONFIG.maxSummaryBytes + 1)),
      finishScript({ type: 'finish', reason: { kind: 'max-tokens' } }),
      finishScript({ type: 'finish', reason: { kind: 'tool-calls' } }),
      finishScript({ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'E' } } }),
      finishScript({ type: 'finish', reason: { kind: 'aborted', failure: { message: 'stopped', code: 'A' } } }),
      finishScript({ type: 'finish', reason: { kind: 'unknown' } as never }),
    ])
    const warn = vi.spyOn(ctx.logger, 'warn')
    const session = createTurn(ctx)
    appendPrompt(session, 'Turn one prompt.')
    endTurn(session, 1)
    await vi.waitFor(() => { expect(summaryEvents(session)).toHaveLength(1) })

    for (let turn = 2; turn <= 9; turn++) {
      session.append('turn/start', { turn })
      appendPrompt(session, `Turn ${turn} prompt.`)
      endTurn(session, turn)
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(turn) })
      await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(turn - 1) })
    }

    expect(summaryEvents(session)).toHaveLength(1)
    expect(summaryText(ctx, session)).toBe('Accepted summary text.')
  })

  it('drops the oldest entries until the framed request fits maxInputBytes', async () => {
    const config: conversationSummary.Config = { ...CONFIG, maxInputBytes: 220, maxEntryBytes: 80 }
    const { ctx, adapter } = await setupAdapter(
      new ScriptedAdapter([textScript('Trimmed summary.')]),
      config,
    )
    const session = createTurn(ctx)
    appendPrompt(session, `FIRST-ENTRY-MARKER ${'a'.repeat(40)}`)
    appendPrompt(session, `SECOND-ENTRY-MARKER ${'b'.repeat(40)}`)
    endTurn(session, 1)

    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const prompt = adapter.requests[0]?.messages[0]?.content[0]
    const text = prompt?.type === 'text' ? prompt.text : ''
    expect(text).toContain('SECOND-ENTRY-MARKER')
    expect(text).not.toContain('FIRST-ENTRY-MARKER')
    expect(requestEvents(session)[0]?.data.sourceSeqs).toHaveLength(1)
  })

  it('fails without recording a request when the framed input cannot fit at all', async () => {
    const config: conversationSummary.Config = { ...CONFIG, maxInputBytes: 10 }
    const { ctx, adapter } = await setupAdapter(
      new ScriptedAdapter([textScript('must not dispatch')]),
      config,
    )
    const warn = vi.spyOn(ctx.logger, 'warn')
    const session = createTurn(ctx)
    appendPrompt(session, 'A prompt that cannot fit.')
    endTurn(session, 1)

    await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(1) })
    expect(warn.mock.calls[0]?.[0]).toContain('exceeds maxInputBytes')
    expect(adapter.requests).toEqual([])
    expect(requestEvents(session)).toEqual([])
    expect(summaryEvents(session)).toEqual([])
  })

  it('aborts and joins the in-flight request during plugin disposal', async () => {
    const adapter = new CooperativeAdapter()
    const { ctx, fiber } = await setupAdapter(adapter)
    const session = createTurn(ctx)
    appendPrompt(session, 'Disposed prompt.')
    endTurn(session, 1)
    const options = await adapter.started.promise
    expect(options.signal?.aborted).toBe(false)

    await fiber.dispose()

    expect(options.signal?.aborted).toBe(true)
    expect(requestEvents(session)).toHaveLength(1)
    expect(summaryEvents(session)).toEqual([])
  })

  it('ignores a Session event published while the plugin is being disposed', async () => {
    const { ctx, fiber } = await setupAdapter(new DelayedAdapter())
    const session = createTurn(ctx)
    appendPrompt(session, 'Disposed prompt.')
    endTurn(session, 1)
    // The request is appended before the adapter's delay, so one macrotask
    // observes it without waiting the delay out.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(requestEvents(session)).toHaveLength(1)

    const disposing = fiber.dispose()
    // The disposal effect sets its flag and then joins the in-flight request,
    // which this adapter holds open. A publication in that window still reaches
    // the not-yet-removed listener and must start no new work.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    appendPrompt(session, 'Published during disposal.')
    await disposing

    expect(summaryEvents(session)).toEqual([])
  })

  it('starts nothing when a newer Turn supersedes the work before dispatch', async () => {
    const { ctx, adapter } = await setup([textScript('must not dispatch')])
    const session = createTurn(ctx)
    appendPrompt(session, 'Superseded prompt.')
    endTurn(session, 1)
    session.append('turn/start', { turn: 2 })

    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(adapter.requests).toEqual([])
    expect(requestEvents(session)).toEqual([])
  })

  it('aborts an in-flight request when its Session is disposed', async () => {
    const adapter = new CooperativeAdapter()
    const { ctx } = await setupAdapter(adapter)
    const session = ctx.sessions.prepare(SessionId(`summary-${++nextSession}`))
    const detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    session.append('turn/start', { turn: 1 })
    appendPrompt(session, 'Disposed session prompt.')
    endTurn(session, 1)
    const options = await adapter.started.promise

    detach()

    expect(options.signal?.aborted).toBe(true)
  })

  it('ignores disposal of a Session it never observed', async () => {
    const { ctx } = await setup([textScript('unused')])
    const session = ctx.sessions.prepare(SessionId(`summary-${++nextSession}`))
    const detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)

    expect(() => { detach() }).not.toThrow()
  })
})

describe('conversation summary configuration', () => {
  const invalid: readonly (readonly [string, unknown])[] = [
    ['a null configuration', null],
    ['an unknown key', { ...CONFIG, extra: 1 }],
    ['a zero limit', { ...CONFIG, targetSentences: 0 }],
    ['a non-integer limit', { ...CONFIG, maxEntryBytes: 1.5 }],
    ['a timeout above the timer limit', { ...CONFIG, timeoutMs: Number.MAX_SAFE_INTEGER }],
    ['an empty provider', { ...CONFIG, provider: '' }],
    ['an empty model', { ...CONFIG, model: '' }],
  ]

  it.each(invalid)('rejects %s', async (_label, config) => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    expect(() => { conversationSummary.apply(ctx, config as conversationSummary.Config) })
      .toThrow(/session-summary-llm:/)
  })
})

describe('conversation summary helpers', () => {
  it('truncates to the byte budget and omits the marker when it cannot fit', () => {
    expect(truncateSummaryUtf8('abcdef', 6)).toBe('abcdef')
    expect(truncateSummaryUtf8('abcdef', 5)).toBe('ab…')
    expect(truncateSummaryUtf8('abcdef', 2)).toBe('ab')
  })

  it('normalizes control sequences and whitespace, and rejects empty or over-budget text', () => {
    expect(normalizeSessionSummary('\u001B[31mhello\u001B[0m\n\n  world  ', 720)).toBe('hello world')
    expect(() => normalizeSessionSummary('   \u0000  ', 720)).toThrow(/no text/)
    expect(() => normalizeSessionSummary('x'.repeat(8), 4)).toThrow(/maxSummaryBytes/)
  })

  it('frames one JSON record carrying the accepted summary and the new entries', () => {
    const entries = collectTurnEntries([], 1, 64)
    expect(entries).toEqual([])
    expect(frameSummaryInput('Prior text.', [])).toContain('"previousSummary":"Prior text."')
  })

  it('folds nothing before the first accepted summary and folds the latest text afterwards', async () => {
    const { ctx } = await setup([textScript('Folded summary.')])
    const session = createTurn(ctx)
    expect(foldSessionSummary(session.snapshotEvents())).toBeUndefined()
    expect(summaryProjectionDefinition.init()).toBeNull()
    appendPrompt(session, 'Fold me.')
    endTurn(session, 1)
    await vi.waitFor(() => { expect(summaryEvents(session)).toHaveLength(1) })
    const folded = foldSessionSummary(session.snapshotEvents())
    expect(folded).toMatchObject({
      summary: 'Folded summary.',
      revision: 1,
      turn: 1,
      route: { provider: 'summary-route', model: 'summary-model' },
    })
    expect(folded?.sourceSeqs).toHaveLength(1)
    const { apply } = summaryProjectionDefinition
    expect(apply(null, session.snapshotEvents()[0]!)).toBeNull()
  })
})
