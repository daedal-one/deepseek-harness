/** Metadata-only SDK diagnostics; runtime epoch timestamps never stand in for controller elapsed time. */

import { expandAssistantStream, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const
type TokenField = typeof TOKEN_FIELDS[number]

/** Settlement classification, independent of external task acceptance. */
export type DeliveryAttemptOutcome = 'successful' | 'cancelled' | 'error' | 'max-tokens' | 'unknown'

/** Runtime-clock diagnostic interval, with no payloads or original identifiers. */
export interface DeliveryTraceSpan {
  readonly kind: 'step' | 'model-attempt' | 'tool'
  readonly session: string
  readonly turn: number
  readonly step: number
  readonly startTimeMs: number | null
  readonly endTimeMs: number | null
  readonly durationMs: number | null
  /** A paired end or durable model settlement, not a task-success verdict. */
  readonly complete: boolean
  /** Regressing runtime clocks yield no duration and contribute no tool timing. */
  readonly clockRegressed: boolean
  readonly outcome?: DeliveryAttemptOutcome
}

interface TraceCounts {
  sessionEvents: number
  duplicateEvents: number
  stepsStarted: number
  stepsEnded: number
  toolCalls: number
  toolResults: number
  settledModelAttempts: number
  assistantMessages: number
  assistantAttempts: number
  retriesScheduled: number
  retriesStarted: number
  compactionsStarted: number
  compactionsEnded: number
}

interface UsageCoverage {
  attempts: number
  unreportedAttempts: number
}

/** Detached, bounded diagnostics; counters and usage cover even settlements whose spans were truncated. */
export interface DeliveryTraceReport {
  readonly clock: 'runtime-session-unix-epoch-ms'
  readonly semantics: {
    readonly step: 'step/start-to-step/end'
    readonly modelAttempt: 'first-recorded-stream-chunk-to-last-recorded-stream-chunk'
    readonly tool: 'tool/call-to-tool/result'
    readonly attribution: 'diagnostic-only; no provider-queue, request-start, controller-clock, or critical-path attribution'
    readonly pending: 'open step/tool spans retained; unsettled model streams unavailable over SDK'
  }
  readonly counts: Readonly<TraceCounts>
  readonly usage: {
    readonly usageSamples: number
    readonly unreportedAttempts: number
    /** Partial sums of reported values only; null means this field was never reported. */
    readonly reportedTotals: Readonly<Record<TokenField, number | null>>
    /** Per-field coverage; subtract from settledModelAttempts to obtain missing-field counts. */
    readonly fieldSamples: Readonly<Record<TokenField, number>>
    readonly outcomes: Readonly<Record<DeliveryAttemptOutcome, Readonly<UsageCoverage>>>
  }
  readonly spans: readonly DeliveryTraceSpan[]
  readonly maxSpans: number
  readonly truncatedSpans: number
  readonly tools: {
    readonly scope: 'retained-complete-spans-only'
    readonly summedServiceMs: number
    /** Union across retained tool intervals on the single runtime's reported epoch clock. */
    readonly unionWallMs: number
    readonly completeSpans: number
    readonly incompleteSpans: number
    readonly clockRegressions: number
  }
}

interface AttemptMetadata {
  start: number | null
  end: number | null
  clockRegressed: boolean
  usage: TokenUsage | undefined
  outcome: DeliveryAttemptOutcome
}

interface ParsedEvent {
  type: string
  seq: number
  time: number
  turn: number
  step: number
  callId: string | undefined
  attempt: AttemptMetadata | undefined
}

type MutableSpan = { -readonly [K in keyof DeliveryTraceSpan]: DeliveryTraceSpan[K] }

function invalid(field: string): never {
  // Diagnostics never interpolate wire values, which can contain source or credentials.
  throw new TypeError(`coding-delivery trace: malformed ${field}`)
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(field)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(field)
  return value
}

function integer(value: unknown, field: string, nonnegative = true): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (nonnegative && value < 0)) invalid(field)
  return value
}

function parseUsage(value: unknown): TokenUsage {
  const data = object(value, 'usage')
  const usage: TokenUsage = {
    inputTokens: integer(data.inputTokens, 'usage.inputTokens'),
    outputTokens: integer(data.outputTokens, 'usage.outputTokens'),
  }
  for (const field of TOKEN_FIELDS) {
    if (data[field] !== undefined) usage[field] = integer(data[field], `usage.${field}`)
  }
  return usage
}

function parseAttempt(data: Record<string, unknown>): AttemptMetadata {
  if (!Array.isArray(data.stream)) invalid('assistant stream')
  // expandAssistantStream is the public durable-record parser. Its raw chunks remain opaque,
  // so validate usage/finish fields before passing records to the trusted record-level reader.
  const stream = data.stream as AssistantStreamRecord[]
  let chunks: ReturnType<typeof expandAssistantStream>
  try {
    chunks = expandAssistantStream(stream)
  } catch {
    invalid('assistant stream records')
  }
  let previous: number | undefined
  let clockRegressed = false
  for (const timed of chunks) {
    const chunk = object(timed.chunk, 'assistant stream chunk')
    text(chunk.type, 'assistant stream chunk type')
    if (chunk.type === 'usage') parseUsage(chunk.usage)
    if (chunk.type === 'finish') text(object(chunk.reason, 'finish reason').kind, 'finish reason kind')
    if (previous !== undefined && timed.time < previous) clockRegressed = true
    previous = timed.time
  }
  const fallback = data.usage === undefined ? undefined : parseUsage(data.usage)
  const reported = lastAssistantStreamChunk(stream, 'usage')?.usage
  const usage = reported === undefined ? fallback : parseUsage(reported)
  const finish = lastAssistantStreamChunk(stream, 'finish')?.reason.kind
  if (data.interrupted !== undefined && data.interrupted !== true) invalid('assistant interrupted marker')
  const outcome: DeliveryAttemptOutcome = data.interrupted === true || finish === 'aborted' ? 'cancelled'
    : finish === 'stop' || finish === 'tool-calls' ? 'successful'
      : finish === 'error' ? 'error' : finish === 'max-tokens' ? 'max-tokens' : 'unknown'
  return {
    start: chunks[0]?.time ?? null,
    end: chunks.at(-1)?.time ?? null,
    clockRegressed,
    usage,
    outcome,
  }
}

function parseEvent(value: unknown): ParsedEvent {
  const event = object(value, 'event')
  const type = text(event.type, 'event.type')
  const seq = integer(event.seq, 'event.seq')
  const time = integer(event.time, 'event.time', false)
  const data = object(event.data, 'event.data')
  let turn = 0
  let step = 0
  let callId: string | undefined
  let attempt: AttemptMetadata | undefined
  switch (type) {
    case 'step/start':
    case 'step/end':
    case 'tool/call':
    case 'tool/result':
    case 'assistant/message':
    case 'assistant/attempt':
    case 'llm/retry':
    case 'llm/retry-started':
      turn = integer(data.turn, 'event.data.turn')
      step = integer(data.step, 'event.data.step')
      break
    case 'compaction/start':
    case 'compaction/end':
      text(data.compactionId, 'compaction identity')
      if (data.turn !== null) integer(data.turn, 'compaction turn')
      break
    default:
      // Session events are merge-extensible; unrelated payloads are neither read nor retained.
      break
  }
  if (type === 'tool/call') callId = text(data.callId, 'tool call identity')
  if (type === 'tool/result') {
    const message = object(data.message, 'tool result message')
    callId = text(object(message.source, 'tool result source').callId, 'tool result identity')
  }
  if (type === 'assistant/message' || type === 'assistant/attempt') attempt = parseAttempt(data)
  return { type, seq, time, turn, step, callId, attempt }
}

function tokenRecord<T>(value: (field: TokenField) => T): Record<TokenField, T> {
  return {
    inputTokens: value('inputTokens'), outputTokens: value('outputTokens'), totalTokens: value('totalTokens'),
    cacheReadTokens: value('cacheReadTokens'), cacheWriteTokens: value('cacheWriteTokens'), reasoningTokens: value('reasoningTokens'),
  }
}

function toolTiming(spans: readonly DeliveryTraceSpan[]): DeliveryTraceReport['tools'] {
  const tools = spans.filter(span => span.kind === 'tool')
  const intervals = tools.flatMap((span): [number, number][] => span.complete && !span.clockRegressed
    && span.startTimeMs !== null && span.endTimeMs !== null ? [[span.startTimeMs, span.endTimeMs]] : [])
  intervals.sort((a, b) => a[0] - b[0])
  let summedServiceMs = 0
  let unionWallMs = 0
  let unionEnd: number | undefined
  for (const [start, end] of intervals) {
    summedServiceMs += end - start
    unionWallMs += Math.max(0, end - Math.max(start, unionEnd ?? start))
    unionEnd = Math.max(unionEnd ?? end, end)
  }
  return {
    scope: 'retained-complete-spans-only', summedServiceMs, unionWallMs,
    completeSpans: tools.filter(span => span.complete).length,
    incompleteSpans: tools.filter(span => !span.complete).length,
    clockRegressions: tools.filter(span => span.clockRegressed).length,
  }
}

/** Accumulate one runtime's ordered SDK notifications without retaining model or tool payloads. */
export class DeliveryTrace {
  private readonly sessions = new Map<string, { alias: string; lastSeq: number }>()
  private readonly spans: MutableSpan[] = []
  private readonly openSteps = new Map<string, MutableSpan>()
  private readonly openTools = new Map<string, MutableSpan>()
  private truncatedSpans = 0
  private usageSamples = 0
  private readonly tokenTotals = tokenRecord(() => 0)
  private readonly fieldSamples = tokenRecord(() => 0)
  private readonly outcomes: Record<DeliveryAttemptOutcome, UsageCoverage> = {
    successful: { attempts: 0, unreportedAttempts: 0 }, cancelled: { attempts: 0, unreportedAttempts: 0 },
    error: { attempts: 0, unreportedAttempts: 0 }, 'max-tokens': { attempts: 0, unreportedAttempts: 0 },
    unknown: { attempts: 0, unreportedAttempts: 0 },
  }
  private readonly counts: TraceCounts = {
    sessionEvents: 0, duplicateEvents: 0, stepsStarted: 0, stepsEnded: 0, toolCalls: 0, toolResults: 0,
    settledModelAttempts: 0, assistantMessages: 0, assistantAttempts: 0,
    retriesScheduled: 0, retriesStarted: 0, compactionsStarted: 0, compactionsEnded: 0,
  }

  /** @param maxSpans - nonnegative retention limit; counters and reported usage remain complete after truncation. */
  constructor(private readonly maxSpans = 1_000) {
    if (!Number.isSafeInteger(maxSpans) || maxSpans < 0) throw new TypeError('coding-delivery trace: maxSpans must be a nonnegative safe integer')
  }

  /**
   * Read one SDK notification. Per-session seq values at or below the high-water mark are replay duplicates.
   * @param notification - SDK wire notification; non-session notifications are ignored.
   * @throws TypeError for malformed consumed metadata, without including the rejected payload in diagnostics.
   */
  observe(notification: HarnessNotification): void {
    if (notification.method !== 'session.event') return
    const params = object(notification.params, 'notification params')
    const id = text(params.sessionId, 'session identity')
    const event = parseEvent(params.event)
    let session = this.sessions.get(id)
    if (session !== undefined && event.seq <= session.lastSeq) {
      this.counts.duplicateEvents++
      return
    }
    if (session === undefined) {
      session = { alias: `session-${this.sessions.size + 1}`, lastSeq: event.seq }
      this.sessions.set(id, session)
    }
    session.lastSeq = event.seq
    this.counts.sessionEvents++
    const stepKey = JSON.stringify([session.alias, event.turn, event.step])
    const toolKey = JSON.stringify([session.alias, event.callId])
    switch (event.type) {
      case 'step/start':
        this.counts.stepsStarted++
        this.openSpan('step', session.alias, event, this.openSteps, stepKey)
        break
      case 'step/end':
        this.counts.stepsEnded++
        this.closeSpan(this.openSteps, stepKey, event.time)
        break
      case 'tool/call':
        this.counts.toolCalls++
        this.openSpan('tool', session.alias, event, this.openTools, toolKey)
        break
      case 'tool/result':
        this.counts.toolResults++
        this.closeSpan(this.openTools, toolKey, event.time)
        break
      case 'assistant/message':
      case 'assistant/attempt':
        if (event.type === 'assistant/message') this.counts.assistantMessages++
        else this.counts.assistantAttempts++
        this.recordAttempt(session.alias, event)
        break
      case 'llm/retry': this.counts.retriesScheduled++; break
      case 'llm/retry-started': this.counts.retriesStarted++; break
      case 'compaction/start': this.counts.compactionsStarted++; break
      case 'compaction/end': this.counts.compactionsEnded++; break
      default: break
    }
  }

  /** @returns detached counters, coverage, bounded spans, and retained-tool timing; open work stays incomplete. */
  snapshot(): DeliveryTraceReport {
    const spans = this.spans.map(span => ({ ...span }))
    return {
      clock: 'runtime-session-unix-epoch-ms',
      semantics: {
        step: 'step/start-to-step/end',
        modelAttempt: 'first-recorded-stream-chunk-to-last-recorded-stream-chunk',
        tool: 'tool/call-to-tool/result',
        attribution: 'diagnostic-only; no provider-queue, request-start, controller-clock, or critical-path attribution',
        pending: 'open step/tool spans retained; unsettled model streams unavailable over SDK',
      },
      counts: { ...this.counts },
      usage: {
        usageSamples: this.usageSamples,
        unreportedAttempts: this.counts.settledModelAttempts - this.usageSamples,
        reportedTotals: tokenRecord(field => this.fieldSamples[field] === 0 ? null : this.tokenTotals[field]),
        fieldSamples: { ...this.fieldSamples },
        outcomes: {
          successful: { ...this.outcomes.successful }, cancelled: { ...this.outcomes.cancelled },
          error: { ...this.outcomes.error }, 'max-tokens': { ...this.outcomes['max-tokens'] }, unknown: { ...this.outcomes.unknown },
        },
      },
      spans, maxSpans: this.maxSpans, truncatedSpans: this.truncatedSpans,
      tools: toolTiming(spans),
    }
  }

  private retain(span: MutableSpan): boolean {
    if (this.spans.length >= this.maxSpans) {
      this.truncatedSpans++
      return false
    }
    this.spans.push(span)
    return true
  }

  private openSpan(
    kind: 'step' | 'tool', session: string, event: ParsedEvent,
    open: Map<string, MutableSpan>, key: string,
  ): void {
    const span: MutableSpan = {
      kind, session, turn: event.turn, step: event.step,
      startTimeMs: event.time, endTimeMs: null, durationMs: null, complete: false, clockRegressed: false,
    }
    if (this.retain(span)) open.set(key, span)
  }

  private closeSpan(open: Map<string, MutableSpan>, key: string, time: number): void {
    const span = open.get(key)
    if (span === undefined) return
    open.delete(key)
    span.endTimeMs = time
    span.complete = true
    span.clockRegressed = time < (span.startTimeMs as number)
    span.durationMs = span.clockRegressed ? null : time - (span.startTimeMs as number)
  }

  private recordAttempt(session: string, event: ParsedEvent): void {
    const attempt = event.attempt as AttemptMetadata
    this.counts.settledModelAttempts++
    this.outcomes[attempt.outcome].attempts++
    if (attempt.usage === undefined) this.outcomes[attempt.outcome].unreportedAttempts++
    else {
      this.usageSamples++
      for (const field of TOKEN_FIELDS) {
        const value = attempt.usage[field]
        if (value === undefined) continue
        this.tokenTotals[field] += value
        this.fieldSamples[field]++
      }
    }
    this.retain({
      kind: 'model-attempt', session, turn: event.turn, step: event.step,
      startTimeMs: attempt.start, endTimeMs: attempt.end,
      durationMs: attempt.start === null || attempt.end === null || attempt.clockRegressed ? null : attempt.end - attempt.start,
      complete: true, clockRegressed: attempt.clockRegressed, outcome: attempt.outcome,
    })
  }
}
