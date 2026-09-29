/**
 * Model-free operation-event replay.
 * @module @deepseek-ai/dsh-experimental-operation/replay
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { equalJson, resolveJsonPointer } from './json.ts'
import { assertionsPassed, evaluateOperationAssertions, resolveOperationExpression } from './resolution.ts'
import type {
  OperationActionCandidate,
  OperationJudgmentRequestEventData,
  OperationJudgmentResponse,
  OperationJudgmentResultEventData,
  OperationRunStartEventData,
  OperationRunEndEventData,
  OperationStepResultEventData,
  OperationTransitionEventData,
  OperationPlan,
  OperationRunId,
  OperationStatus,
  OperationStep,
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
  /** Canonical recorded result and execution diagnostics, when settlement survived. */
  readonly result?: OperationStepResultEventData
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
  /** Exact response or failure record, including runner-measured elapsed time. */
  readonly result?: OperationJudgmentResultEventData
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
  /** Frozen plan, limits, and tool/provider identities retained verbatim. */
  readonly admission: OperationRunStartEventData
  /** Every recorded selection and exact bound arguments, in order. */
  readonly transitions: readonly OperationTransitionEventData[]
  /** Terminal verification and completed/attempted steps, if durably recorded. */
  readonly terminal?: OperationRunEndEventData
}

/**

 * Replay one durable operation without tools or inference. Step intents must follow
 * the admitted order and accepted source-bound transitions. Completed outcomes require
 * the final checkpoint and verification consistent with canonical results.
 * Interrupted prefixes retain unknown outcomes.

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
  const settledJudgments = new Set<string>()
  const transitioned = new Set<string>()
  const settledSteps = new Set<string>()
  const transitions: OperationTransitionEventData[] = []
  const candidates: OperationActionCandidate[] = []
  const results = new Map<string, JsonValue>()
  const plan = selected.data.plan
  let currentStep: OperationStep | undefined
  let checkpoint: OperationJudgmentRequestEventData | undefined
  let pendingContinuation: OperationTransitionEventData | undefined
  let completedCheckpoint = false
  let terminal: OperationRunEndEventData | undefined
  let started = false

  for (const event of events) {
    if (!isSelectedEvent(event, id)) continue
    if (terminal !== undefined) throw new OperationReplayError(`operation run ${JSON.stringify(id)} has an event after operation/run-end`)
    if (!started && event.type !== 'operation/run-start') throw new OperationReplayError('operation event precedes its run-start record')
    switch (event.type) {
      case 'operation/run-start':
        if (started || event !== selected) throw new OperationReplayError(`operation run ${JSON.stringify(id)} has duplicate run-start records`)
        started = true
        break
      case 'operation/step-start': {
        if (steps.has(event.data.stepId)) throw new OperationReplayError(`operation run ${JSON.stringify(id)} started step ${JSON.stringify(event.data.stepId)} twice`)
        const expected = plan.steps[steps.size]
        if (expected === undefined || expected.id !== event.data.stepId || expected.tool !== event.data.tool) {
          throw new OperationReplayError('operation step intent does not match the next fixed plan step and tool')
        }
        if (steps.size > 0 && (pendingContinuation === undefined || !pendingContinuation.accepted
          || pendingContinuation.nextStep !== event.data.stepId || pendingContinuation.arguments === undefined
          || !equalJson(pendingContinuation.arguments, event.data.arguments))) {
          throw new OperationReplayError('operation step intent does not match its preceding accepted continuation')
        }
        if (steps.size === 0) validateBoundArguments(plan, results, expected, event.data.arguments)
        currentStep = expected
        checkpoint = undefined
        pendingContinuation = undefined
        steps.set(event.data.stepId, { stepId: event.data.stepId, tool: event.data.tool, arguments: event.data.arguments, outcome: 'unknown' })
        break
      }
      case 'operation/step-result': {
        const prior = steps.get(event.data.stepId)
        if (prior === undefined || settledSteps.has(event.data.stepId)) throw new OperationReplayError(`operation run ${JSON.stringify(id)} has an unpaired step result`)
        if (currentStep?.id !== event.data.stepId) throw new OperationReplayError('operation step result is out of sequence')
        const outcome = event.data.error?.code === 'ABORTED' ? 'unknown' : event.data.isError ? 'failed' : 'succeeded'
        steps.set(event.data.stepId, { ...prior, outcome, result: event.data })
        if (!event.data.isError && event.data.value !== undefined) results.set(event.data.stepId, event.data.value)
        settledSteps.add(event.data.stepId)
        break
      }
      case 'operation/judgment-request': {
        if (judgments.has(event.data.request.draft.id)) throw new OperationReplayError(`operation run ${JSON.stringify(id)} recorded a judgment request twice`)
        if (checkpoint !== undefined) throw new OperationReplayError('operation step has multiple judgment checkpoints')
        if (currentStep === undefined || steps.get(currentStep.id)?.outcome !== 'succeeded' || !results.has(currentStep.id)) {
          throw new OperationReplayError('operation judgment has no preceding successful canonical step result')
        }
        const expectedKind = steps.size === plan.steps.length ? 'completion' : 'continuation'
        if (event.data.request.draft.runId !== id || event.data.request.draft.kind !== expectedKind) {
          throw new OperationReplayError('operation judgment does not match its run and sequential checkpoint')
        }
        checkpoint = event.data
        judgments.set(event.data.request.draft.id, { request: event.data })
        candidates.push(...event.data.request.draft.candidates)
        break
      }
      case 'operation/judgment-result': {
        const prior = judgments.get(event.data.requestId)
        if (prior === undefined || settledJudgments.has(event.data.requestId)) {
          throw new OperationReplayError(`operation run ${JSON.stringify(id)} has an unpaired judgment result`)
        }
        if (event.data.response !== undefined) {
          if (event.data.response.requestId !== event.data.requestId) {
            throw new OperationReplayError(`operation run ${JSON.stringify(id)} has a judgment response for a different request`)
          }
        }
        judgments.set(event.data.requestId, {
          ...prior,
          ...(event.data.response === undefined ? {} : { response: event.data.response }),
          result: event.data,
        })
        settledJudgments.add(event.data.requestId)
        break
      }
      case 'operation/transition': {
        if (transitioned.has(event.data.requestId)) throw new OperationReplayError('operation judgment has duplicate transitions')
        const judgment = judgments.get(event.data.requestId)
        if (judgment === undefined) throw new OperationReplayError(`operation run ${JSON.stringify(id)} transitioned without a recorded judgment request`)
        if (checkpoint?.request.draft.id !== event.data.requestId) throw new OperationReplayError('operation transition is not for the current checkpoint')
        const response = judgment.response
        if (response === undefined) throw new OperationReplayError(`operation run ${JSON.stringify(id)} transitioned without a recorded judgment response`)
        const candidate = judgment.request.request.draft.candidates.find(entry => entry.id === event.data.candidateId)
        if (candidate === undefined || !Object.hasOwn(response.probabilities, event.data.candidateId)) {
          throw new OperationReplayError(`operation run ${JSON.stringify(id)} transitioned without a recorded response/request candidate`)
        }
        if (candidate.nextStep !== event.data.nextStep) {
          throw new OperationReplayError(`operation run ${JSON.stringify(id)} transitioned with a next step that does not match its recorded candidate`)
        }
        if (candidate.arguments === undefined
          ? event.data.arguments !== undefined
          : event.data.arguments === undefined || !equalJson(candidate.arguments, event.data.arguments)) {
          throw new OperationReplayError(`operation run ${JSON.stringify(id)} transitioned with arguments that do not match its recorded candidate`)
        }
        const autonomous = candidate.kind === 'continue' || candidate.kind === 'complete'
        if (event.data.accepted !== autonomous) throw new OperationReplayError('operation transition acceptance contradicts its candidate kind')
        if (candidate.kind === 'continue') {
          const next = plan.steps[steps.size]
          if (pendingContinuation !== undefined || next === undefined
            || candidate.nextStep !== next.id || candidate.arguments === undefined) {
            throw new OperationReplayError('operation continuation does not name the next fixed plan step')
          }
          if (candidate.source !== undefined && candidate.source.step !== currentStep?.id) {
            throw new OperationReplayError('operation selected source is not the preceding canonical step')
          }
          validateBoundArguments(plan, results, next, candidate.arguments, candidate)
          pendingContinuation = event.data
        } else if (candidate.kind === 'complete') {
          if (checkpoint.request.draft.kind !== 'completion' || steps.size !== plan.steps.length) {
            throw new OperationReplayError('operation complete transition is not the final checkpoint')
          }
          completedCheckpoint = true
        }
        transitioned.add(event.data.requestId)
        transitions.push(event.data)
        break
      }
      case 'operation/run-end':
        if (event.data.status === 'completed') {
          validateCompleted(plan, steps, results, event.data, completedCheckpoint)
        }
        terminal = event.data
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
    admission: selected.data,
    transitions,
    ...(terminal === undefined ? {} : { terminal }),
  }
}

function validateBoundArguments(
  plan: OperationPlan,
  results: ReadonlyMap<string, JsonValue>,
  step: OperationStep,
  args: JsonValue,
  candidate?: OperationActionCandidate,
): void {
  const source = candidate?.source
  if (source !== undefined) {
    const canonical = results.get(source.step)
    const selected = canonical === undefined ? undefined : resolveJsonPointer(canonical, source.pointer)
    if (selected === undefined || !selected.found || !equalJson(selected.value, source.value)) {
      throw new OperationReplayError('operation selected source does not match its canonical recorded result')
    }
  }
  let resolved: JsonValue
  try {
    resolved = resolveOperationExpression(step.arguments, {
      inputs: plan.inputs,
      results,
      ...(source === undefined ? {} : { selected: new Map([[source.step, source.value]]) }),
    }).value
  } catch {
    throw new OperationReplayError('operation arguments cannot be resolved from recorded sources')
  }
  if (!equalJson(resolved, args)) throw new OperationReplayError('operation arguments do not match their recorded plan and sources')
}

function validateCompleted(
  plan: OperationPlan,
  steps: ReadonlyMap<string, OperationReplayStep>,
  results: ReadonlyMap<string, JsonValue>,
  terminal: OperationRunEndEventData,
  completedCheckpoint: boolean,
): void {
  if (!completedCheckpoint || steps.size !== plan.steps.length) {
    throw new OperationReplayError('completed operation lacks its final accepted completion checkpoint')
  }
  const expectedSteps = plan.steps.map(step => step.id)
  if (!equalJson(expectedSteps, [...terminal.attemptedSteps]) || !equalJson(expectedSteps, [...terminal.completedSteps])) {
    throw new OperationReplayError('completed operation step lists contradict the admitted plan')
  }
  const context = { inputs: plan.inputs, results }
  for (const step of plan.steps) {
    const recorded = steps.get(step.id)
    const expected = evaluateOperationAssertions(step.assertions, context)
    if (recorded?.outcome !== 'succeeded' || recorded.result === undefined || !results.has(step.id)
      || !assertionsPassed(expected) || !equalJson(expected as unknown as JsonValue, recorded.result.assertions as unknown as JsonValue)) {
      throw new OperationReplayError('completed operation step verification contradicts its canonical recorded results')
    }
  }
  const expected = evaluateOperationAssertions(plan.completion.assertions, context)
  if (!assertionsPassed(expected) || !equalJson(expected as unknown as JsonValue, terminal.verification as unknown as JsonValue)) {
    throw new OperationReplayError('completed operation verification contradicts its canonical recorded results')
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
