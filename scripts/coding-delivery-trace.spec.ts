import { describe, expect, it } from 'vitest'
import { AssistantStreamAccumulator, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { DeliveryTrace } from '../benchmarks/coding-delivery/trace.ts'

function event(seq: number, time: number, type: string, data: unknown, sessionId = 'private-session'): HarnessNotification {
  return { method: 'session.event', params: { sessionId, event: { seq, time, type, data } } }
}

function stream(...chunks: [number, StreamChunk][]): ReturnType<AssistantStreamAccumulator['snapshot']> {
  const accumulator = new AssistantStreamAccumulator()
  for (const [time, chunk] of chunks) accumulator.push({ time, chunk })
  return accumulator.snapshot()
}

function toolResult(callId: string): object {
  return { turn: 1, step: 1, message: { source: { kind: 'tool', callId }, content: [{ type: 'text', text: 'private output' }] } }
}

function message(
  seq: number, time: number, chunks: ReturnType<typeof stream>, extra: Record<string, unknown> = {},
): HarnessNotification {
  return event(seq, time, 'assistant/message', {
    turn: 1, step: 1, stream: chunks, message: { content: [{ type: 'text', text: 'private response' }] }, ...extra,
  })
}

const usage: TokenUsage = { inputTokens: 10, outputTokens: 3, cacheReadTokens: 5 }


describe('coding delivery metadata trace', () => {
  it('distinguishes overlapped tool union wall time from summed service time', () => {
    const trace = new DeliveryTrace()
    trace.observe(event(0, 1_000, 'step/start', { turn: 1, step: 1 }))
    trace.observe(event(1, 1_010, 'tool/call', { turn: 1, step: 1, callId: 'first', arguments: 'private source' }))
    trace.observe(event(2, 1_020, 'tool/call', { turn: 1, step: 1, callId: 'second' }))
    trace.observe(event(3, 1_040, 'tool/result', toolResult('first')))
    trace.observe(event(4, 1_050, 'tool/result', toolResult('second')))
    trace.observe(event(5, 1_060, 'step/end', { turn: 1, step: 1 }))

    const report = trace.snapshot()
    expect(report.clock).toBe('runtime-session-unix-epoch-ms')
    expect(report.tools).toEqual({
      scope: 'retained-complete-spans-only', summedServiceMs: 60, unionWallMs: 40,
      completeSpans: 2, incompleteSpans: 0, clockRegressions: 0,
    })
    expect(report.spans[0]).toMatchObject({ kind: 'step', startTimeMs: 1_000, endTimeMs: 1_060, durationMs: 60, complete: true })
    expect(report.counts).toMatchObject({ stepsStarted: 1, stepsEnded: 1, toolCalls: 2, toolResults: 2 })
    expect(report.semantics.attribution).toContain('no provider-queue, request-start, controller-clock, or critical-path attribution')
  })

  it('counts retry attempts and only the final reported usage of each settlement', () => {
    const trace = new DeliveryTrace()
    trace.observe(event(0, 90, 'step/start', { turn: 1, step: 1 }))
    trace.observe(event(1, 125, 'assistant/attempt', { turn: 1, step: 1, stream: stream(
      [100, { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }],
      [120, { type: 'finish', reason: { kind: 'error', failure: { message: 'private error', code: 'TEMPORARY' } } }],
    ) }))
    trace.observe(event(2, 130, 'llm/retry', { turn: 1, step: 1, failure: 'private error', retry: 1 }))
    trace.observe(event(3, 150, 'llm/retry-started', { turn: 1, step: 1, retry: 1 }))
    trace.observe(message(4, 220, stream(
      [160, { type: 'block-start', index: 0, blockType: 'text' }],
      [170, { type: 'text-delta', index: 0, text: 'private text' }],
      [180, { type: 'text-delta', index: 0, text: 'private tail' }],
      [190, { type: 'usage', usage: { inputTokens: 6, outputTokens: 2 } }],
      [200, { type: 'usage', usage }],
      [210, { type: 'finish', reason: { kind: 'stop' } }],
    ), { usage }))
    trace.observe(event(5, 225, 'step/end', { turn: 1, step: 1 }))

    const report = trace.snapshot()
    expect(report.counts).toMatchObject({
      settledModelAttempts: 2, assistantMessages: 1, assistantAttempts: 1, retriesScheduled: 1, retriesStarted: 1,
    })
    expect(report.usage).toMatchObject({
      usageSamples: 2, unreportedAttempts: 0,
      reportedTotals: {
        inputTokens: 12, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: null, totalTokens: null, reasoningTokens: null,
      },
      fieldSamples: { inputTokens: 2, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 },
      outcomes: { successful: { attempts: 1, unreportedAttempts: 0 }, error: { attempts: 1, unreportedAttempts: 0 } },
    })
    expect(report.spans.filter(span => span.kind === 'model-attempt')).toMatchObject([
      { startTimeMs: 100, endTimeMs: 120, durationMs: 20, outcome: 'error' },
      { startTimeMs: 160, endTimeMs: 210, durationMs: 50, outcome: 'successful' },
    ])
  })

  it('preserves missing usage separately for successful, cancelled, and unknown attempts', () => {
    const trace = new DeliveryTrace()
    trace.observe(message(0, 20, stream([10, { type: 'finish', reason: { kind: 'stop' } }])))
    trace.observe(event(1, 40, 'assistant/attempt', { turn: 1, step: 1, stream: stream(
      [30, { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'private cancellation' } } }],
    ) }))
    trace.observe(message(2, 60, [], { interrupted: true }))
    trace.observe(event(3, 70, 'assistant/attempt', { turn: 1, step: 1, stream: [] }))
    const emptyUsage = trace.snapshot().usage
    expect(emptyUsage.usageSamples).toBe(0)
    expect(emptyUsage.unreportedAttempts).toBe(4)
    expect(Object.values(emptyUsage.reportedTotals)).toEqual([null, null, null, null, null, null])
    expect(emptyUsage.outcomes).toMatchObject({
      successful: { attempts: 1, unreportedAttempts: 1 }, cancelled: { attempts: 2, unreportedAttempts: 2 },
      unknown: { attempts: 1, unreportedAttempts: 1 },
    })
    expect(trace.snapshot().spans.at(-1)).toMatchObject({ startTimeMs: null, endTimeMs: null, durationMs: null, complete: true })

    trace.observe(message(4, 100, stream([90, { type: 'finish', reason: { kind: 'max-tokens' } }]), { usage }))
    expect(trace.snapshot().usage).toMatchObject({
      usageSamples: 1, unreportedAttempts: 4, reportedTotals: { inputTokens: 10, outputTokens: 3 },
      fieldSamples: { inputTokens: 1 }, outcomes: { 'max-tokens': { attempts: 1, unreportedAttempts: 0 } },
    })
  })

  it('retains open spans without fabricating a timeout end or a live model duration', () => {
    const trace = new DeliveryTrace()
    trace.observe(event(0, 10, 'step/start', { turn: 1, step: 1 }))
    trace.observe(event(1, 20, 'tool/call', { turn: 1, step: 1, callId: 'pending' }))
    trace.observe({ method: 'session.status', params: { sessionId: 'private-session', status: 'running' } })
    const pending = trace.snapshot()
    expect(pending.spans).toHaveLength(2)
    expect(pending.spans.every(span => !span.complete && span.endTimeMs === null && span.durationMs === null)).toBe(true)
    expect(pending.counts.settledModelAttempts).toBe(0)
    expect(pending.tools).toMatchObject({ summedServiceMs: 0, unionWallMs: 0, incompleteSpans: 1 })

    trace.observe(event(2, 30, 'tool/result', toolResult('pending')))
    trace.observe(event(3, 40, 'step/end', { turn: 1, step: 1 }))
    expect(trace.snapshot().spans.every(span => span.complete)).toBe(true)
    expect(pending.spans.every(span => !span.complete)).toBe(true)
  })

  it('deduplicates replayed sequence numbers independently for each aliased session', () => {
    const trace = new DeliveryTrace()
    const first = event(0, 10, 'tool/call', { turn: 1, step: 1, callId: 'same' }, 'private-root')
    const second = event(0, 20, 'tool/call', { turn: 1, step: 1, callId: 'same' }, 'private-child')
    trace.observe(first)
    trace.observe(second)
    trace.observe(first)
    trace.observe(event(1, 30, 'tool/result', toolResult('same'), 'private-root'))
    trace.observe(event(1, 40, 'tool/result', toolResult('same'), 'private-child'))
    trace.observe(second)
    expect(trace.snapshot().counts).toMatchObject({ sessionEvents: 4, duplicateEvents: 2, toolCalls: 2, toolResults: 2 })
    expect(trace.snapshot().spans.map(span => span.session)).toEqual(['session-1', 'session-2'])
    expect(trace.snapshot().tools).toMatchObject({ summedServiceMs: 40, unionWallMs: 30 })
  })

  it('never retains raw identifiers, content, tool arguments, or error bodies', () => {
    const trace = new DeliveryTrace()
    const secret = 'DO-NOT-RETAIN-THIS-PAYLOAD'
    trace.observe(event(0, 10, 'user/message', { content: [{ type: 'text', text: secret }] }, secret))
    trace.observe(event(1, 20, 'tool/call', { turn: 1, step: 1, callId: secret, name: secret, arguments: secret }, secret))
    trace.observe(event(2, 30, 'tool/result', toolResult(secret), secret))
    trace.observe(event(3, 40, 'assistant/attempt', { turn: 1, step: 1, stream: stream(
      [31, { type: 'tool-call-delta', index: 0, id: ToolCallId(secret), name: secret, argumentsDelta: secret }],
      [32, { type: 'tool-call-delta', index: 0, id: ToolCallId(secret), name: secret, argumentsDelta: secret }],
      [39, { type: 'finish', reason: { kind: 'error', failure: { code: secret, message: secret } } }],
    ) }, secret))
    trace.observe(event(4, 50, 'compaction/start', { compactionId: secret, turn: null }, secret))
    trace.observe(event(5, 60, 'compaction/end', { compactionId: secret, turn: null, error: secret }, secret))
    const report = trace.snapshot()
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(report.counts).toMatchObject({ compactionsStarted: 1, compactionsEnded: 1, settledModelAttempts: 1 })
  })

  it('bounds retained spans while keeping complete event and usage counts', () => {
    const trace = new DeliveryTrace(2)
    trace.observe(event(0, 10, 'step/start', { turn: 1, step: 1 }))
    trace.observe(event(1, 20, 'tool/call', { turn: 1, step: 1, callId: 'retained' }))
    trace.observe(event(2, 30, 'tool/call', { turn: 1, step: 1, callId: 'truncated' }))
    trace.observe(message(3, 40, stream([39, { type: 'usage', usage }])))
    trace.observe(event(4, 50, 'tool/result', toolResult('retained')))
    trace.observe(event(5, 60, 'tool/result', toolResult('truncated')))
    const report = trace.snapshot()
    expect(report.spans).toHaveLength(2)
    expect(report.truncatedSpans).toBe(2)
    expect(report.maxSpans).toBe(2)
    expect(report.counts).toMatchObject({ toolCalls: 2, toolResults: 2, settledModelAttempts: 1 })
    expect(report.usage).toMatchObject({ usageSamples: 1, reportedTotals: { inputTokens: 10, outputTokens: 3 } })
    expect(report.tools).toMatchObject({ completeSpans: 1, summedServiceMs: 30, unionWallMs: 30 })
    expect(report.spans[0]?.complete).toBe(false)
  })

  it('reports regressing runtime clocks without negative durations or inflated tool unions', () => {
    const trace = new DeliveryTrace()
    trace.observe(event(0, 100, 'tool/call', { turn: 1, step: 1, callId: 'regressed' }))
    trace.observe(event(1, 90, 'tool/result', toolResult('regressed')))
    trace.observe(message(2, 120, stream(
      [100, { type: 'text-delta', index: 0, text: 'one' }],
      [80, { type: 'text-delta', index: 0, text: 'two' }],
      [110, { type: 'finish', reason: { kind: 'stop' } }],
    )))
    expect(trace.snapshot().spans.every(span => span.complete && span.clockRegressed && span.durationMs === null)).toBe(true)
    expect(trace.snapshot().tools).toMatchObject({ summedServiceMs: 0, unionWallMs: 0, clockRegressions: 1 })
  })

  it.each([
    null,
    { seq: 0, time: 10, type: 'step/start', data: { turn: 1 } },
    { seq: '0', time: 10, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 0, time: Number.NaN, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 0, time: 10, type: 'tool/result', data: { turn: 1, step: 1, message: { source: {} } } },
    { seq: 0, time: 10, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: null } },
    { seq: 0, time: 10, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [null] } },
    { seq: 0, time: 10, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [
      { type: 'text-chunks', time0: 0, index: 0, dt: [1], texts: ['only one'] },
    ] } },
    { seq: 0, time: 10, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [
      { type: 'chunk', time: 1, chunk: { type: 'usage', usage: { inputTokens: -1, outputTokens: 2 } } },
    ] } },
    { seq: 0, time: 10, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [
      { type: 'chunk', time: 1, chunk: { type: 'finish', reason: null } },
    ] } },
    { seq: 0, time: 10, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [
      { type: 'chunk', time: 1, chunk: {} },
    ] } },
  ])('rejects malformed wire metadata without committing a partial observation (%#)', (raw) => {
    const trace = new DeliveryTrace()
    const before = trace.snapshot()
    expect(() => { trace.observe({ method: 'session.event', params: { sessionId: 'session', event: raw } }) })
      .toThrow(/^coding-delivery trace: malformed /)
    expect(trace.snapshot()).toEqual(before)
  })

  it('keeps malformed-wire diagnostics payload-free', () => {
    const trace = new DeliveryTrace()
    const bad = message(0, 1, [], { usage: { inputTokens: 'private-secret', outputTokens: 1 } })
    expect(() => { trace.observe(bad) }).toThrow('coding-delivery trace: malformed usage.inputTokens')
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])('rejects invalid retention limit %s', (maxSpans) => {
    expect(() => new DeliveryTrace(maxSpans)).toThrow('maxSpans must be a nonnegative safe integer')
  })
})
