/**
 * Model-free operation-event replay.
 * @module @deepseek-ai/dsh-experimental-operation/replay
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  OperationActionCandidate,
  OperationJudgmentRequestEventData,
  OperationJudgmentResponse,
  OperationPlan,
  OperationRunId,
  OperationStatus,
} from './types.ts'

/**

 * Reconstructed terminal status when no durable run-end exists.

 */
export type OperationReplayStatus = OperationStatus | 'interrupted'

/**

 * One replayed step and its available durable outcome.

 */
export interface OperationReplayStep {
  /**
   * Fixed plan step identity.
   */
  readonly stepId: string
  /**
   * Fixed dispatched tool name.
   */
  readonly tool: string
  /**
   * Complete recorded arguments.
   */
  readonly arguments: unknown
  /**
   * Whether no terminal step result was recorded.
   */
  readonly outcome: 'succeeded' | 'failed' | 'unknown'
}

/**

 * One replayed judgment request and optional response.

 */
export interface OperationReplayJudgment {
  /**
   * Exact pre-inference request record.
   */
  readonly request: OperationJudgmentRequestEventData
  /**
   * Persisted response if the request settled before interruption.
   */
  readonly response?: OperationJudgmentResponse
}

/**

 * Pure reconstruction of an operation log without executing tools or models.

 */
export interface OperationReplay {
  /**
   * Selected operation identity.
   */
  readonly runId: OperationRunId
  /**
   * Frozen admitted plan.
   */
  readonly plan: OperationPlan
  /**
   * Terminal state or interruption when no run-end survives.
   */
  readonly status: OperationReplayStatus
  /**
   * Terminal reason or inferred interrupted tail.
   */
  readonly reason: string
  /**
   * Started steps with settled/unknown outcomes.
   */
  readonly steps: readonly OperationReplayStep[]
  /**
   * Exact recorded requests and responses.
   */
  readonly judgments: readonly OperationReplayJudgment[]
  /**
   * Every supplied candidate mapping from exact recorded requests.
   */
  readonly candidates: readonly OperationActionCandidate[]
}

/**

 * Replay one selected durable operation from session events only.

 * @param events Complete session event sequence.

 * @param runId Optional run identity; omission requires exactly one operation run.

 * @returns Reconstructed immutable operation facts.

 */
export function replayOperation(events: readonly SessionEvent[], runId?: OperationRunId): OperationReplay {
  const starts = events.filter(event => event.type === 'operation/run-start')
  const selected = runId === undefined
    ? starts.length === 1 ? starts[0] : undefined
    : starts.find(event => event.data.runId === runId)
  if (selected === undefined) throw new OperationReplayError(runId === undefined
    ? 'operation replay requires exactly one operation/run-start event'
    : `operation run ${JSON.stringify(runId)} was not found`)
  const id = selected.data.runId
  const steps = new Map<string, OperationReplayStep>()
  const judgments = new Map<string, OperationReplayJudgment>()
  const candidates: OperationActionCandidate[] = []
  let terminal: { status: OperationReplayStatus; reason: string } | undefined

  for (const event of events) {
    if (!isSelectedEvent(event, id)) continue
    switch (event.type) {
      case 'operation/run-start':
        if (event !== selected) throw new OperationReplayError(`operation run ${JSON.stringify(id)} has duplicate run-start records`)
        break
      case 'operation/step-start':
        if (steps.has(event.data.stepId)) throw new OperationReplayError(`operation run ${JSON.stringify(id)} started step ${JSON.stringify(event.data.stepId)} twice`)
        steps.set(event.data.stepId, { stepId: event.data.stepId, tool: event.data.tool, arguments: event.data.arguments, outcome: 'unknown' })
        break
      case 'operation/step-result': {
        const prior = steps.get(event.data.stepId)
        if (prior === undefined || prior.outcome !== 'unknown') throw new OperationReplayError(`operation run ${JSON.stringify(id)} has an unpaired step result`)
        steps.set(event.data.stepId, { ...prior, outcome: event.data.isError ? 'failed' : 'succeeded' })
        break
      }
      case 'operation/judgment-request':
        if (judgments.has(event.data.request.draft.id)) throw new OperationReplayError(`operation run ${JSON.stringify(id)} recorded a judgment request twice`)
        judgments.set(event.data.request.draft.id, { request: event.data })
        candidates.push(...event.data.request.draft.candidates)
        break
      case 'operation/judgment-result': {
        const prior = judgments.get(event.data.requestId)
        if (prior === undefined || prior.response !== undefined) throw new OperationReplayError(`operation run ${JSON.stringify(id)} has an unpaired judgment result`)
        if (event.data.response !== undefined) judgments.set(event.data.requestId, { ...prior, response: event.data.response })
        break
      }
      case 'operation/transition':
        if (!judgments.has(event.data.requestId)) throw new OperationReplayError(`operation run ${JSON.stringify(id)} transitioned without a recorded judgment request`)
        break
      case 'operation/run-end':
        if (terminal !== undefined) throw new OperationReplayError(`operation run ${JSON.stringify(id)} has multiple run-end records`)
        terminal = { status: event.data.status, reason: event.data.reason }
        break
      default:
        break
    }
  }
  return {
    runId: id,
    plan: selected.data.plan,
    status: terminal?.status ?? 'interrupted',
    reason: terminal?.reason ?? 'no durable operation/run-end record',
    steps: [...steps.values()],
    judgments: [...judgments.values()],
    candidates,
  }
}

/**

 * Replay boundary error for contradictory or incomplete durable record ordering.

 */
export class OperationReplayError extends Error {
  /**
   * @param message Stable replay integrity failure.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationReplayError'
  }
}

function isSelectedEvent(event: SessionEvent, runId: OperationRunId): boolean {
  switch (event.type) {
    case 'operation/run-start':
    case 'operation/step-start':
    case 'operation/step-result':
    case 'operation/judgment-request':
    case 'operation/judgment-result':
    case 'operation/transition':
    case 'operation/run-end':
      return event.data.runId === runId
    default:
      return false
  }
}
