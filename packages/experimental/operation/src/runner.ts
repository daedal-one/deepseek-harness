/**
 * Bounded sequential operation runner with strict recording barriers.
 * @module @deepseek-ai/dsh-experimental-operation/runner
 */

import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { digestJson, equalJson, jsonBytes, requireJson } from './json.ts'
import { OperationJudgmentRegistry } from './judgment.ts'
import { buildContinuationCandidates, completionControls, observeCanonicalResult, withIntermediateControls } from './observation.ts'
import { parseOperationPlan, OperationPlanError } from './plan.ts'
import type { OperationToolPolicy } from './policy.ts'
import { OperationToolPolicyRegistry } from './policy.ts'
import { OperationRecorder } from './recorder.ts'
import { assertionsPassed, evaluateOperationAssertions, resolveOperationExpression } from './resolution.ts'
import type { OperationResolutionContext } from './resolution.ts'
import type {
  OperationActionCandidate,
  OperationAssertionResult,
  OperationCandidateId,
  OperationJudgmentDraft,
  OperationJudgmentIdentity,
  OperationJudgmentProvider,
  OperationJudgmentResponse,
  OperationPreparedJudgment,
  OperationLimits,
  OperationPlan,
  OperationRunId,
  OperationStatus,
  OperationStep,
  OperationSummary,
  OperationToolIdentity,
  OperationValueProvenance,
} from './types.ts'
import { OperationJudgmentRequestId, OperationRunId as toOperationRunId } from './types.ts'

/**

 * Deployment configuration accepted by the operation service.

 */
export interface OperationConfig extends Partial<OperationLimits> {
  /**
   * Additional fixed tool names that operation plans may never dispatch.
   */
  forbiddenTools?: string[]
}

/**

 * Defaults resolved once at the operation service boundary.

 */
export const DEFAULT_OPERATION_LIMITS: OperationLimits = {
  maxPlanBytes: 65_536,
  maxSteps: 12,
  maxWallMs: 120_000,
  maxToolDeadlineMs: 30_000,
  maxJudgmentDeadlineMs: 15_000,
  maxToolCalls: 12,
  maxJudgments: 12,
  maxResultBytes: 262_144,
  maxObservationBytes: 65_536,
  maxCandidates: 16,
  maxCandidateBytes: 8_192,
  maxJudgmentInputTokens: 16_384,
  maxJudgmentOutputTokens: 1_024,
  minimumProbability: 0.7,
  minimumMargin: 0.1,
  requireCalibration: true,
}

const DISTRIBUTION_TOLERANCE = 1e-6

/**

 * Runner-owned failure after the durable terminal record has been attempted.

 */
export class OperationRunError extends Error {
  /**
   * Machine-routable terminal cause.
   */
  readonly code: string

  /**

   * @param message Stable failure detail.

   * @param code Machine-routable terminal cause.

   */
  constructor(message: string, code: string) {
    super(message)
    this.name = 'OperationRunError'
    this.code = code
  }
}

interface AdmittedStep {
  readonly definition: ToolDefinition
  readonly identity: OperationToolIdentity
  readonly policy: OperationToolPolicy
}

interface PreparedStep {
  readonly step: OperationStep
  readonly arguments: JsonValue
  readonly bindings: readonly OperationValueProvenance[]
  readonly admitted: AdmittedStep
}

interface OperationSelection {
  readonly requestId: OperationJudgmentRequestId
  readonly candidate: OperationActionCandidate
  readonly accepted: boolean
  readonly reason: string
}

interface RunnerState {
  readonly runId: OperationRunId
  readonly plan: OperationPlan
  readonly limits: OperationLimits
  readonly recorder: OperationRecorder
  readonly provider: OperationJudgmentProvider
  readonly providerIdentity: OperationJudgmentIdentity
  readonly admitted: ReadonlyMap<string, AdmittedStep>
  readonly results: Map<string, JsonValue>
  readonly attempted: string[]
  readonly completed: string[]
  readonly startedAt: number
  toolCalls: number
  judgments: number
  inputTokens: number
  outputTokens: number
  ended: boolean
}

/**

 * Executes one finite plan through the ordinary nested tool pipeline.

 */
export class OperationRunner {
  /**
   * @param ctx Calling composition context.
   * @param judgments Configured narrow judgment seam.
   * @param toolPolicies Trusted exact-definition operation eligibility.
   * @param config Resolved deployment configuration.
   */
  constructor(
    private readonly ctx: Context,
    private readonly judgments: OperationJudgmentRegistry,
    private readonly toolPolicies: OperationToolPolicyRegistry,
    private readonly config: OperationConfig,
  ) {}

  /**

   * Parse, admit, record, and run a finite operation plan.

   * @param exec Outer tool execution identity.

   * @param rawPlan Untrusted model-supplied JSON plan.

   * @returns Summary for non-infrastructure terminal outcomes.

   */
  async run(exec: ToolRunContext, rawPlan: unknown): Promise<OperationSummary> {
    if (exec.agent === undefined) throw new OperationRunError('run_operation requires a calling agent', 'NO_AGENT')
    if (exec.signal.aborted) throw new OperationRunError('operation was cancelled before admission', 'CANCELLED')
    const plan = parseOperationPlan(rawPlan)
    const limits = resolveOperationLimits(this.config, plan.requestedLimits)
    if (jsonBytes(plan as unknown as JsonValue) > limits.maxPlanBytes) throw new OperationRunError(`operation plan exceeds ${limits.maxPlanBytes} bytes`, 'PLAN_LIMIT')
    const provider = this.judgments.requireProvider()
    validateIdentity(provider.identity, limits.requireCalibration)
    const admitted = this.admit(plan, exec, limits)
    const runId = toOperationRunId(randomUUID())
    const recorder = new OperationRecorder(this.ctx, exec.agent.session)
    const state: RunnerState = {
      runId,
      plan,
      limits,
      recorder,
      provider,
      providerIdentity: provider.identity,
      admitted,
      results: new Map(),
      attempted: [],
      completed: [],
      startedAt: Date.now(),
      toolCalls: 0,
      judgments: 0,
      inputTokens: 0,
      outputTokens: 0,
      ended: false,
    }
    try {
      await recorder.appendAndFlush('operation/run-start', {
        version: 1,
        runId,
        rootCallId: exec.rootCallId,
        plan,
        planDigest: digestJson(plan as unknown as JsonValue),
        limits,
        toolIdentities: [...admitted.values()].map(entry => entry.identity),
        judgmentIdentity: provider.identity,
      })
      if (signalAborted(exec.signal)) return await this.cancel(state, 'caller cancelled before first dispatch')
      const firstStep = plan.steps[0]
      if (firstStep === undefined) throw new OperationRunError('operation plan has no first step', 'RUNNER_INVARIANT')
      let prepared = this.prepareStep(state, exec, firstStep)
      await this.recordStepStart(state, exec, prepared)

      for (let index = 0; index < plan.steps.length; index += 1) {
        const step = plan.steps[index]
        if (step === undefined) throw new OperationRunError('operation plan step is missing', 'RUNNER_INVARIANT')
        if (prepared.step !== step) throw new OperationRunError('operation runner lost sequential step ordering', 'RUNNER_INVARIANT')
        const outcome = await this.dispatchStep(state, exec, prepared)
        if (outcome.result.isError) {
          await this.recordStepResult(state, step, outcome.result, [], outcome.elapsedMs)
          if (outcome.callerCancelled || signalAborted(exec.signal)) return await this.cancel(state, 'caller cancelled during tool dispatch')
          if (outcome.timedOut) return await this.fail(state, `tool ${JSON.stringify(step.tool)} exceeded operation deadline`, 'TOOL_TIMEOUT')
          return await this.fail(state, `tool ${JSON.stringify(step.tool)} failed: ${outcome.result.error.message}`, 'TOOL_FAILED')
        }
        if (outcome.callerCancelled || signalAborted(exec.signal)) {
          await this.recordStepResult(state, step, outcome.result, [], outcome.elapsedMs)
          return await this.cancel(state, 'caller cancelled during tool dispatch')
        }
        if (outcome.timedOut) {
          await this.recordStepResult(state, step, outcome.result, [], outcome.elapsedMs)
          return await this.fail(state, `tool ${JSON.stringify(step.tool)} exceeded operation deadline`, 'TOOL_TIMEOUT')
        }
        for (const context of outcome.result.additionalContexts ?? []) exec.deferContext(context)
        const resultBytes = jsonBytes(outcome.result.value)
        if (resultBytes > limits.maxResultBytes) {
          await this.recordStepResult(state, step, outcome.result, [], outcome.elapsedMs, {
            omitPayload: true,
            reason: `canonical result omitted because ${resultBytes} bytes exceeds the ${limits.maxResultBytes}-byte limit`,
          })
          return await this.fail(state, `step ${JSON.stringify(step.id)} canonical result exceeds ${limits.maxResultBytes} bytes`, 'RESULT_LIMIT')
        }
        let inspection
        try {
          inspection = prepared.admitted.policy.inspectResult(outcome.result.value)
        } catch (error: unknown) {
          await this.recordStepResult(state, step, outcome.result, [], outcome.elapsedMs)
          return await this.fail(state, `trusted result inspection failed for step ${JSON.stringify(step.id)}: ${message(error)}`, 'PROCESS_FAILED')
        }
        if (inspection.kind === 'failed') {
          await this.recordStepResult(state, step, outcome.result, [], outcome.elapsedMs)
          return await this.fail(state, inspection.reason, 'PROCESS_FAILED')
        }
        if (inspection.kind === 'incomplete') {
          await this.recordStepResult(state, step, outcome.result, [], outcome.elapsedMs)
          return await this.finish(state, 'needs-replan', inspection.reason, [])
        }
        state.results.set(step.id, outcome.result.value)
        const assertions = evaluateOperationAssertions(step.assertions, resolutionContext(state))
        await this.recordStepResult(state, step, outcome.result, assertions, outcome.elapsedMs)
        if (signalAborted(exec.signal)) return await this.cancel(state, 'caller cancelled after tool dispatch')
        if (!assertionsPassed(assertions)) return await this.finish(state, 'stopped', `required assertions failed for step ${JSON.stringify(step.id)}`, assertions)
        state.completed.push(step.id)
        if (outcome.result.concludesTurn) {
          exec.concludeTurn()
          return await this.finish(state, 'stopped', `step ${JSON.stringify(step.id)} concluded the current turn`, assertions)
        }
        let observations
        try {
          observations = observeCanonicalResult(step, outcome.result.value, limits.maxObservationBytes)
        } catch (error: unknown) {
          return await this.finish(state, 'needs-replan', message(error), assertions)
        }
        const next = plan.steps[index + 1]
        if (next === undefined) {
          const completion = evaluateOperationAssertions(plan.completion.assertions, resolutionContext(state))
          if (!assertionsPassed(completion)) return await this.finish(state, 'stopped', 'declared completion assertions failed', completion)
          const evidence = this.completionEvidence(plan, state)
          const selection = await this.judge(state, exec, 'completion', step, observations, plan.completion.question, completionControls(), evidence)
          this.recordTransition(state, selection)
          if (selection.candidate.kind === 'complete') return await this.finish(state, 'completed', 'completion checkpoint accepted', completion)
          if (selection.candidate.kind === 'stop') return await this.finish(state, 'stopped', 'completion checkpoint selected stop', completion)
          return await this.finish(state, 'needs-replan', 'completion checkpoint returned control to planner', completion)
        }
        let candidates: readonly OperationActionCandidate[]
        try {
          candidates = withIntermediateControls(buildContinuationCandidates(
            step,
            next,
            outcome.result.value,
            resolutionContext(state),
            limits.maxCandidates - 2,
            limits.maxCandidateBytes,
          ))
        } catch (error: unknown) {
          return await this.finish(state, 'needs-replan', message(error), assertions)
        }
        const selection = await this.judge(state, exec, 'continuation', step, observations, step.question, candidates, [])
        if (selection.candidate.kind === 'needs-replan') {
          this.recordTransition(state, selection)
          return await this.finish(state, 'needs-replan', 'checkpoint returned control to planner', assertions)
        }
        if (selection.candidate.kind === 'stop') {
          this.recordTransition(state, selection)
          return await this.finish(state, 'stopped', 'checkpoint selected stop', assertions)
        }
        if (selection.candidate.kind !== 'continue' || selection.candidate.nextStep !== next.id || selection.candidate.arguments === undefined) {
          return await this.fail(state, 'judgment selected an invalid continuation candidate', 'INVALID_SELECTION')
        }
        try {
          prepared = this.prepareSelectedStep(state, exec, next, selection.candidate)
        } catch (error: unknown) {
          return await this.finish(state, 'needs-replan', message(error), assertions)
        }
        this.recordTransition(state, selection)
        await this.recordStepStart(state, exec, prepared)
      }
      throw new OperationRunError('operation runner exhausted steps without a terminal checkpoint', 'RUNNER_INVARIANT')
    } catch (error: unknown) {
      if (state.ended) throw error
      if (signalAborted(exec.signal)) return await this.cancel(state, 'caller cancelled')
      if (error instanceof OperationPlanError) throw error
      return await this.fail(state, message(error), error instanceof OperationRunError ? error.code : 'RUNNER_FAILURE')
    }
  }

  private admit(plan: OperationPlan, exec: ToolRunContext, limits: OperationLimits): ReadonlyMap<string, AdmittedStep> {
    if (plan.steps.length > limits.maxSteps || plan.steps.length > limits.maxToolCalls) throw new OperationRunError('operation plan exceeds configured step or tool-call limit', 'STEP_LIMIT')
    if (plan.steps.length > limits.maxJudgments) throw new OperationRunError('operation plan cannot fit its mandatory checkpoints', 'JUDGMENT_BUDGET')
    if (limits.maxCandidates < 3) throw new OperationRunError('operation candidate limit cannot fit the mandatory control choices', 'CANDIDATE_LIMIT')
    const forbidden = new Set(this.config.forbiddenTools ?? [])
    const admitted = new Map<string, AdmittedStep>()
    for (const step of plan.steps) {
      if (step.tool === 'run_operation' || forbidden.has(step.tool)) {
        throw new OperationRunError(`operation plan cannot dispatch excluded tool ${JSON.stringify(step.tool)}`, 'TOOL_EXCLUDED')
      }
      const definition = this.ctx.tools.admitted(step.tool, exec.agent, true)
      if (definition === undefined) throw new OperationRunError(`operation tool ${JSON.stringify(step.tool)} is unavailable or undiscovered`, 'TOOL_UNAVAILABLE')
      let policy: OperationToolPolicy
      try {
        policy = this.toolPolicies.require(definition)
      } catch (error: unknown) {
        throw new OperationRunError(`operation tool ${JSON.stringify(step.tool)} is not eligible: ${message(error)}`, 'TOOL_POLICY')
      }
      const staticallyResolvable = isStaticallyResolvable(step.arguments)
      if (!staticallyResolvable && !policy.allowOutputReferences) {
        throw new OperationRunError(`operation tool ${JSON.stringify(step.tool)} does not allow output-derived arguments`, 'TOOL_POLICY')
      }
      const entry = { definition, identity: toolIdentity(definition), policy }
      admitted.set(step.id, entry)
      if (staticallyResolvable) {
        const resolved = resolveOperationExpression(step.arguments, { inputs: plan.inputs, results: new Map() })
        validateArguments(step, definition, policy, resolved.value)
      }
    }
    return admitted
  }

  private prepareStep(state: RunnerState, exec: ToolRunContext, step: OperationStep): PreparedStep {
    const resolved = resolveOperationExpression(step.arguments, resolutionContext(state))
    return this.validatedPreparedStep(state, exec, step, resolved.value, resolved.provenance)
  }

  private prepareSelectedStep(
    state: RunnerState,
    exec: ToolRunContext,
    step: OperationStep,
    candidate: OperationActionCandidate,
  ): PreparedStep {
    const context = resolutionContext(state)
    const resolved = candidate.source === undefined
      ? resolveOperationExpression(step.arguments, context)
      : resolveOperationExpression(step.arguments, { ...context, selected: new Map([[candidate.source.step, candidate.source.value]]) })
    const candidateArguments = candidate.arguments
    if (candidateArguments === undefined) throw new OperationRunError('selected continuation has no arguments', 'CANDIDATE_MISMATCH')
    if (!equalJson(resolved.value, candidateArguments)) throw new OperationRunError('selected candidate arguments no longer match recorded candidate mapping', 'CANDIDATE_MISMATCH')
    return this.validatedPreparedStep(state, exec, step, resolved.value, resolved.provenance)
  }

  private validatedPreparedStep(
    state: RunnerState,
    exec: ToolRunContext,
    step: OperationStep,
    argumentsValue: JsonValue,
    bindings: readonly OperationValueProvenance[],
  ): PreparedStep {
    const admitted = state.admitted.get(step.id)
    if (admitted === undefined) throw new OperationRunError(`step ${JSON.stringify(step.id)} was not admitted`, 'ADMISSION_MISMATCH')
    const current = this.ctx.tools.admitted(step.tool, exec.agent, true)
    if (current === undefined) throw new OperationRunError(`tool ${JSON.stringify(step.tool)} is no longer available`, 'TOOL_CHANGED')
    if (current !== admitted.definition) throw new OperationRunError(`tool ${JSON.stringify(step.tool)} definition changed after admission`, 'TOOL_CHANGED')
    let currentPolicy: OperationToolPolicy
    try {
      currentPolicy = this.toolPolicies.require(current)
    } catch (error: unknown) {
      throw new OperationRunError(`tool ${JSON.stringify(step.tool)} operation policy is no longer available: ${message(error)}`, 'TOOL_CHANGED')
    }
    if (currentPolicy !== admitted.policy) throw new OperationRunError(`tool ${JSON.stringify(step.tool)} operation policy changed after admission`, 'TOOL_CHANGED')
    if (toolIdentity(current).schemaDigest !== admitted.identity.schemaDigest) throw new OperationRunError(`tool ${JSON.stringify(step.tool)} schema changed after admission`, 'TOOL_CHANGED')
    validateArguments(step, current, currentPolicy, argumentsValue)
    return { step, arguments: argumentsValue, bindings, admitted }
  }

  private async recordStepStart(state: RunnerState, exec: ToolRunContext, prepared: PreparedStep): Promise<void> {
    this.requireRemaining(state, exec.signal)
    if (state.toolCalls >= state.limits.maxToolCalls) throw new OperationRunError('operation tool-call budget is exhausted', 'TOOL_BUDGET')
    const callId = nestedCallId(exec, state.runId, prepared.step.id)
    await state.recorder.appendAndFlush('operation/step-start', {
      version: 1,
      runId: state.runId,
      stepId: prepared.step.id,
      tool: prepared.step.tool,
      callId,
      arguments: prepared.arguments,
      bindings: prepared.bindings,
    })
  }

  private async dispatchStep(
    state: RunnerState,
    exec: ToolRunContext,
    prepared: PreparedStep,
  ): Promise<{ result: ToolExecutionResult; elapsedMs: number; callerCancelled: boolean; timedOut: boolean }> {
    this.requireRemaining(state, exec.signal)
    const current = this.validatedPreparedStep(state, exec, prepared.step, prepared.arguments, prepared.bindings)
    const timeout = Math.min(state.limits.maxToolDeadlineMs, this.remainingMs(state))
    if (timeout <= 0) throw new OperationRunError('operation wall-time budget is exhausted before tool dispatch', 'WALL_TIME')
    const startedAt = Date.now()
    using d = deadline(exec.signal, timeout, 'OPERATION_TOOL_TIMEOUT')
    state.attempted.push(current.step.id)
    state.toolCalls += 1
    const execution = {
      callId: nestedCallId(exec, state.runId, current.step.id),
      rootCallId: exec.rootCallId,
      parent: exec.token,
      name: current.step.tool,
      arguments: current.arguments,
      ...(exec.agent === undefined ? {} : { agent: exec.agent }),
      signal: d.signal,
      dispatchConstraint: {
        expectedDefinition: current.admitted.definition,
        validate: (definition: ToolDefinition, argumentsValue: JsonValue) => {
          if (definition !== current.admitted.definition) {
            throw new OperationRunError(`tool ${JSON.stringify(current.step.tool)} definition changed at dispatch`, 'TOOL_CHANGED')
          }
          let policy: OperationToolPolicy
          try {
            policy = this.toolPolicies.require(definition)
          } catch (error: unknown) {
            throw new OperationRunError(`tool ${JSON.stringify(current.step.tool)} operation policy is unavailable at dispatch: ${message(error)}`, 'TOOL_CHANGED')
          }
          if (policy !== current.admitted.policy) {
            throw new OperationRunError(`tool ${JSON.stringify(current.step.tool)} operation policy changed at dispatch`, 'TOOL_CHANGED')
          }
          if (toolIdentity(definition).schemaDigest !== current.admitted.identity.schemaDigest) {
            throw new OperationRunError(`tool ${JSON.stringify(current.step.tool)} schema changed at dispatch`, 'TOOL_CHANGED')
          }
          if (!equalJson(argumentsValue, current.arguments)) {
            throw new OperationRunError(`tool ${JSON.stringify(current.step.tool)} arguments changed at dispatch`, 'TOOL_CHANGED')
          }
          validateArguments(current.step, definition, policy, argumentsValue)
        },
      },
    }
    const result = await this.ctx.tools.execute(execution)
    return {
      result,
      elapsedMs: Date.now() - startedAt,
      callerCancelled: signalAborted(exec.signal),
      timedOut: timeoutOf(d.signal, 'OPERATION_TOOL_TIMEOUT') !== undefined,
    }
  }

  private async recordStepResult(
    state: RunnerState,
    step: OperationStep,
    result: ToolExecutionResult,
    assertions: readonly OperationAssertionResult[],
    elapsedMs: number,
    omission?: { readonly omitPayload: true; readonly reason: string },
  ): Promise<void> {
    const rendered = result.content as unknown as JsonValue
    const renderedTooLarge = jsonBytes(rendered) > state.limits.maxResultBytes
    const omittedReason = omission?.reason ?? (renderedTooLarge
      ? `rendered result omitted because it exceeds the ${state.limits.maxResultBytes}-byte limit`
      : undefined)
    await state.recorder.appendAndFlush('operation/step-result', {
      version: 1,
      runId: state.runId,
      stepId: step.id,
      isError: result.isError,
      ...(result.isError
        ? { error: { message: result.error.message, ...(result.error.info === undefined ? {} : { code: result.error.info.code }) } }
        : omission === undefined ? { value: result.value } : {}),
      rendered: omittedReason === undefined
        ? rendered
        : [{ type: 'text', text: omittedReason }],
      elapsedMs,
      assertions,
    })
  }

  private completionEvidence(plan: OperationPlan, state: RunnerState): JsonValue {
    return plan.completion.evidence.map(expression => resolveOperationExpression(expression, resolutionContext(state)).value)
  }

  private async judge(
    state: RunnerState,
    exec: ToolRunContext,
    kind: 'continuation' | 'completion',
    step: OperationStep,
    observations: readonly { readonly step: string; readonly pointer: string; readonly value: JsonValue }[],
    question: string,
    candidates: readonly OperationActionCandidate[],
    completionEvidence: JsonValue,
  ): Promise<OperationSelection> {
    this.requireRemaining(state, exec.signal)
    if (state.judgments >= state.limits.maxJudgments) throw new OperationRunError('operation judgment budget is exhausted', 'JUDGMENT_BUDGET')
    if (candidates.length > state.limits.maxCandidates || candidates.some(candidate => Buffer.byteLength(candidate.description, 'utf8') > state.limits.maxCandidateBytes)) {
      throw new OperationRunError('complete judgment choices exceed the configured candidate bounds', 'CANDIDATE_LIMIT')
    }
    const observationState: JsonValue[] = []
    for (const observation of observations) {
      observationState.push({ step: observation.step, pointer: observation.pointer, value: observation.value })
    }
    const draft: OperationJudgmentDraft = {
      id: OperationJudgmentRequestId(`${state.runId}:judgment:${state.judgments}`),
      runId: state.runId,
      kind,
      state: {
        goal: state.plan.goal,
        step: step.id,
        purpose: step.purpose,
        observations: observationState,
        completionEvidence,
      },
      question,
      candidates,
    }
    let prepared: OperationPreparedJudgment
    {
      const prepareTimeout = Math.min(state.limits.maxJudgmentDeadlineMs, this.remainingMs(state))
      if (prepareTimeout <= 0) throw new OperationRunError('operation wall-time budget is exhausted before judgment preparation', 'WALL_TIME')
      using preparationDeadline = deadline(exec.signal, prepareTimeout, 'OPERATION_JUDGMENT_TIMEOUT')
      try {
        prepared = await state.provider.prepare(draft, preparationDeadline.signal)
      } catch (error: unknown) {
        if (signalAborted(exec.signal)) throw new OperationRunError('caller cancelled during judgment preparation', 'CANCELLED')
        if (timeoutOf(preparationDeadline.signal, 'OPERATION_JUDGMENT_TIMEOUT') !== undefined) {
          throw new OperationRunError('operation judgment preparation exceeded deadline', 'JUDGMENT_TIMEOUT')
        }
        throw new OperationRunError(`operation judgment preparation failed: ${message(error)}`, 'JUDGMENT_PREPARE')
      }
      if (signalAborted(exec.signal)) throw new OperationRunError('caller cancelled during judgment preparation', 'CANCELLED')
      if (timeoutOf(preparationDeadline.signal, 'OPERATION_JUDGMENT_TIMEOUT') !== undefined) {
        throw new OperationRunError('operation judgment preparation exceeded deadline', 'JUDGMENT_TIMEOUT')
      }
    }
    validatePrepared(draft, prepared, state.providerIdentity)
    if (state.inputTokens + prepared.inputTokens > state.limits.maxJudgmentInputTokens) throw new OperationRunError('operation judgment input-token budget is exhausted', 'JUDGMENT_TOKEN_BUDGET')
    await state.recorder.appendAndFlush('operation/judgment-request', {
      version: 1,
      runId: state.runId,
      request: prepared,
      remainingInputTokens: state.limits.maxJudgmentInputTokens - state.inputTokens - prepared.inputTokens,
      remainingOutputTokens: state.limits.maxJudgmentOutputTokens - state.outputTokens,
    })
    state.inputTokens += prepared.inputTokens
    state.judgments += 1
    const startedAt = Date.now()
    if (signalAborted(exec.signal)) {
      return await this.judgmentFailure(state, draft.id, startedAt, 'caller cancelled before judgment inference', 'CANCELLED')
    }
    if (this.remainingMs(state) < 1) {
      return await this.judgmentFailure(state, draft.id, startedAt, 'operation wall-time budget is exhausted before judgment inference', 'WALL_TIME')
    }
    let response: OperationJudgmentResponse
    {
      const rankTimeout = Math.min(state.limits.maxJudgmentDeadlineMs, this.remainingMs(state))
      if (rankTimeout <= 0) {
        return await this.judgmentFailure(state, draft.id, startedAt, 'operation wall-time budget is exhausted before judgment inference', 'WALL_TIME')
      }
      using rankingDeadline = deadline(exec.signal, rankTimeout, 'OPERATION_JUDGMENT_TIMEOUT')
      try {
        response = await state.provider.rank(prepared, rankingDeadline.signal)
      } catch (error: unknown) {
        if (signalAborted(exec.signal)) {
          return await this.judgmentFailure(state, draft.id, startedAt, 'caller cancelled during judgment inference', 'CANCELLED')
        }
        if (timeoutOf(rankingDeadline.signal, 'OPERATION_JUDGMENT_TIMEOUT') !== undefined) {
          return await this.judgmentFailure(state, draft.id, startedAt, 'operation judgment request exceeded deadline', 'JUDGMENT_TIMEOUT')
        }
        return await this.judgmentFailure(state, draft.id, startedAt, `operation judgment request failed: ${message(error)}`, 'JUDGMENT_PROVIDER')
      }
      if (signalAborted(exec.signal)) {
        return await this.judgmentFailure(state, draft.id, startedAt, 'caller cancelled during judgment inference', 'CANCELLED')
      }
      if (timeoutOf(rankingDeadline.signal, 'OPERATION_JUDGMENT_TIMEOUT') !== undefined) {
        return await this.judgmentFailure(state, draft.id, startedAt, 'operation judgment request exceeded deadline', 'JUDGMENT_TIMEOUT')
      }
    }
    try {
      validateResponse(draft, response, state.providerIdentity)
    } catch (error: unknown) {
      return await this.judgmentFailure(state, draft.id, startedAt, `operation judgment response is invalid: ${message(error)}`, 'JUDGMENT_RESPONSE')
    }
    await state.recorder.appendAndFlush('operation/judgment-result', {
      version: 1,
      runId: state.runId,
      requestId: draft.id,
      response,
      elapsedMs: Date.now() - startedAt,
    })
    if (signalAborted(exec.signal)) throw new OperationRunError('caller cancelled after judgment inference', 'CANCELLED')
    if (this.remainingMs(state) < 1) throw new OperationRunError('operation wall-time budget is exhausted after judgment inference', 'WALL_TIME')
    const outputTokens = response.usage?.outputTokens ?? 0
    if (state.outputTokens + outputTokens > state.limits.maxJudgmentOutputTokens) {
      throw new OperationRunError('operation judgment output-token budget is exhausted', 'JUDGMENT_TOKEN_BUDGET')
    }
    state.outputTokens += outputTokens
    const selection = selectCandidate(draft.candidates, response, state.limits)
    return { requestId: draft.id, ...selection }
  }

  private async judgmentFailure(
    state: RunnerState,
    requestId: OperationJudgmentRequestId,
    startedAt: number,
    reason: string,
    code: string,
  ): Promise<never> {
    await state.recorder.appendAndFlush('operation/judgment-result', {
      version: 1,
      runId: state.runId,
      requestId,
      error: { message: reason, code },
      elapsedMs: Date.now() - startedAt,
    })
    throw new OperationRunError(reason, code)
  }

  private recordTransition(state: RunnerState, selection: OperationSelection): void {
    state.recorder.append('operation/transition', {
      version: 1,
      runId: state.runId,
      requestId: selection.requestId,
      candidateId: selection.candidate.id,
      accepted: selection.accepted,
      reason: selection.reason,
      ...(selection.candidate.nextStep === undefined ? {} : { nextStep: selection.candidate.nextStep }),
      ...(selection.candidate.arguments === undefined ? {} : { arguments: selection.candidate.arguments }),
    })
  }

  private async finish(
    state: RunnerState,
    status: Extract<OperationStatus, 'completed' | 'needs-replan' | 'stopped'>,
    reason: string,
    verification: readonly OperationAssertionResult[],
  ): Promise<OperationSummary> {
    state.ended = true
    await state.recorder.appendAndFlush('operation/run-end', {
      version: 1,
      runId: state.runId,
      status,
      reason,
      attemptedSteps: state.attempted,
      completedSteps: state.completed,
      verification,
    })
    return summary(state, status, reason, verification)
  }

  private async fail(state: RunnerState, reason: string, code: string): Promise<never> {
    state.ended = true
    await state.recorder.appendAndFlush('operation/run-end', {
      version: 1,
      runId: state.runId,
      status: 'failed',
      reason,
      attemptedSteps: state.attempted,
      completedSteps: state.completed,
      verification: [],
    })
    throw new OperationRunError(reason, code)
  }

  private async cancel(state: RunnerState, reason: string): Promise<never> {
    state.ended = true
    await state.recorder.appendAndFlush('operation/run-end', {
      version: 1,
      runId: state.runId,
      status: 'cancelled',
      reason,
      attemptedSteps: state.attempted,
      completedSteps: state.completed,
      verification: [],
    })
    throw new OperationRunError(reason, 'CANCELLED')
  }

  private requireRemaining(state: RunnerState, signal: AbortSignal): void {
    if (signalAborted(signal)) throw new OperationRunError('operation was cancelled', 'CANCELLED')
    if (this.remainingMs(state) < 1) throw new OperationRunError('operation wall-time budget is exhausted', 'WALL_TIME')
  }

  private remainingMs(state: RunnerState): number {
    return state.limits.maxWallMs - (Date.now() - state.startedAt)
  }
}

function signalAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

type IntegerLimit = Exclude<keyof OperationLimits, 'minimumProbability' | 'minimumMargin' | 'requireCalibration'>
type MutableOperationLimits = { -readonly [Key in keyof OperationLimits]: OperationLimits[Key] }

const INTEGER_LIMITS = [
  'maxPlanBytes', 'maxSteps', 'maxWallMs', 'maxToolDeadlineMs', 'maxJudgmentDeadlineMs', 'maxToolCalls',
  'maxJudgments', 'maxResultBytes', 'maxObservationBytes', 'maxCandidates', 'maxCandidateBytes',
  'maxJudgmentInputTokens', 'maxJudgmentOutputTokens',
] as const satisfies readonly IntegerLimit[]
const PROBABILITY_LIMITS = ['minimumProbability', 'minimumMargin'] as const

/**

 * Resolve direct configuration and plan requests without allowing plan escalation.

 * @param config Optional deployment configuration.

 * @param requested Optional plan request.

 * @returns Fully validated frozen effective limits.

 */
export function resolveOperationLimits(config: OperationConfig, requested: Partial<OperationLimits> | undefined): OperationLimits {
  const configured: OperationLimits = { ...DEFAULT_OPERATION_LIMITS, ...config }
  validateLimits(configured)
  if (requested === undefined) return configured
  const effective: MutableOperationLimits = { ...configured }
  const requestedCalibration = requested.requireCalibration
  if (requestedCalibration !== undefined) {
    if (configured.requireCalibration && !requestedCalibration) throw new OperationRunError('plan cannot disable required provider calibration', 'LIMIT_ESCALATION')
    effective.requireCalibration = requestedCalibration
  }
  for (const key of PROBABILITY_LIMITS) {
    const value = requested[key]
    if (value === undefined) continue
    if (value < configured[key]) throw new OperationRunError(`plan cannot lower ${key}`, 'LIMIT_ESCALATION')
    effective[key] = value
  }
  for (const key of INTEGER_LIMITS) {
    const value = requested[key]
    if (value === undefined) continue
    if (value > configured[key]) throw new OperationRunError(`plan cannot raise ${key}`, 'LIMIT_ESCALATION')
    effective[key] = value
  }
  validateLimits(effective)
  return effective
}

function validateLimits(limits: OperationLimits): void {
  for (const key of INTEGER_LIMITS) {
    const value = limits[key]
    if (!Number.isSafeInteger(value) || value < 1) throw new OperationRunError(`${key} must be a positive safe integer`, 'INVALID_CONFIG')
  }
  for (const key of PROBABILITY_LIMITS) {
    const value = limits[key]
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new OperationRunError(`${key} must be within [0, 1]`, 'INVALID_CONFIG')
  }
}

function toolIdentity(definition: ToolDefinition): OperationToolIdentity {
  const parameters = requireJson(definition.parameters, `tool ${JSON.stringify(definition.name)} parameter schema`)
  const output = requireJson(definition.output.schema, `tool ${JSON.stringify(definition.name)} output schema`)
  return { name: definition.name, schemaDigest: digestJson({ parameters, output }) }
}

function resolutionContext(state: RunnerState): OperationResolutionContext {
  return { inputs: state.plan.inputs, results: state.results }
}

function nestedCallId(exec: ToolRunContext, runId: OperationRunId, stepId: string) {
  return ToolCallId(`${exec.rootCallId}:operation:${runId}:${stepId}`)
}

function isStaticallyResolvable(expression: OperationStep['arguments']): boolean {
  switch (expression.kind) {
    case 'literal':
    case 'input':
      return true
    case 'object':
      return Object.values(expression.properties).every(isStaticallyResolvable)
    case 'array':
      return expression.items.every(isStaticallyResolvable)
    case 'result':
    case 'selected':
      return false
    default:
      return unreachable(expression)
  }
}

function validateArguments(
  step: OperationStep,
  definition: ToolDefinition,
  policy: OperationToolPolicy,
  argumentsValue: JsonValue,
): void {
  const violations = validateJsonSchemaValue(definition.parameters, argumentsValue, 'arguments')
  if (violations.length > 0) {
    throw new OperationRunError(`resolved arguments for ${JSON.stringify(step.tool)} are invalid: ${violations.join('; ')}`, 'INVALID_ARGS')
  }
  try {
    policy.validateArguments(argumentsValue)
  } catch (error: unknown) {
    throw new OperationRunError(`resolved arguments for ${JSON.stringify(step.tool)} violate its operation policy: ${message(error)}`, 'TOOL_POLICY')
  }
}

function validateIdentity(identity: OperationJudgmentIdentity, requireCalibration: boolean): void {
  for (const field of ['provider', 'model', 'encoder', 'tokenizer', 'serialization', 'deployment'] as const) {
    if (identity[field].length === 0) throw new OperationRunError(`operation judgment identity field ${JSON.stringify(field)} must be a non-empty string`, 'PROVIDER_IDENTITY')
  }
  if (identity.calibrationId !== undefined && identity.calibrationId.length === 0) {
    throw new OperationRunError('operation judgment calibration identity must be non-empty', 'PROVIDER_IDENTITY')
  }
  const manifest = identity.deploymentManifest
  if (manifest !== undefined && (manifest.reference.length === 0 || manifest.digest.length === 0)) {
    throw new OperationRunError('operation deployment manifest verification must contain non-empty reference and digest', 'PROVIDER_IDENTITY')
  }
  if (manifest === undefined) throw new OperationRunError('autonomous operation execution requires deployment manifest verification', 'PROVIDER_IDENTITY')
  if (!requireCalibration) return
  if (identity.calibrationId === undefined) throw new OperationRunError('operation provider lacks required calibration identity', 'PROVIDER_CALIBRATION')
}

function validatePrepared(
  draft: OperationJudgmentDraft,
  prepared: OperationPreparedJudgment,
  identity: OperationJudgmentIdentity,
): void {
  if (prepared.draft.id !== draft.id || !equalJson(prepared.draft as unknown as JsonValue, draft as unknown as JsonValue)) throw new OperationRunError('provider changed runner-owned judgment draft', 'PROVIDER_PREPARE')
  if (!equalJson(prepared.identity as unknown as JsonValue, identity as unknown as JsonValue)) throw new OperationRunError('provider changed identity while preparing request', 'PROVIDER_IDENTITY')
  requireJson(prepared.wire, 'prepared judgment wire')
  if (!Number.isSafeInteger(prepared.inputTokens) || prepared.inputTokens < 0) throw new OperationRunError('provider returned invalid exact input-token count', 'PROVIDER_TOKENS')
}

function validateResponse(
  draft: OperationJudgmentDraft,
  response: OperationJudgmentResponse,
  identity: OperationJudgmentIdentity,
): void {
  if (response.requestId !== draft.id) throw new OperationRunError('provider response request identity does not match', 'PROVIDER_RESPONSE')
  if (!equalJson(response.identity as unknown as JsonValue, identity as unknown as JsonValue)) throw new OperationRunError('provider response identity changed', 'PROVIDER_IDENTITY')
  const expected = new Set(draft.candidates.map(candidate => candidate.id))
  const actual = Object.keys(response.probabilities)
  if (actual.length !== expected.size || actual.some(id => !expected.has(id as OperationCandidateId))) {
    throw new OperationRunError('provider response does not cover exactly the supplied candidate ids', 'PROVIDER_RESPONSE')
  }
  let sum = 0
  for (const id of actual) {
    const value = response.probabilities[id]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new OperationRunError(`provider probability for ${JSON.stringify(id)} is invalid`, 'PROVIDER_RESPONSE')
    sum += value
  }
  if (Math.abs(sum - 1) > DISTRIBUTION_TOLERANCE) throw new OperationRunError('provider probabilities must sum to one', 'PROVIDER_RESPONSE')
  if (response.usage !== undefined) {
    const { billingUnits, inputTokens, outputTokens } = response.usage
    if (!Number.isSafeInteger(billingUnits) || billingUnits < 0
      || !Number.isSafeInteger(inputTokens) || inputTokens < 0
      || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
      throw new OperationRunError('provider usage is invalid', 'PROVIDER_TOKENS')
    }
  }
  if (response.providerConfidence !== undefined
    && (!Number.isFinite(response.providerConfidence) || response.providerConfidence < 0 || response.providerConfidence > 1)) {
    throw new OperationRunError('provider confidence is invalid', 'PROVIDER_RESPONSE')
  }
}

function selectCandidate(
  candidates: readonly OperationActionCandidate[],
  response: OperationJudgmentResponse,
  limits: OperationLimits,
): { readonly candidate: OperationActionCandidate; readonly accepted: boolean; readonly reason: string } {
  const probability = (candidate: OperationActionCandidate): number => {
    const value = response.probabilities[candidate.id]
    if (value === undefined) throw new OperationRunError('provider omitted a supplied candidate probability', 'PROVIDER_RESPONSE')
    return value
  }
  const ordered = [...candidates].sort((left, right) => probability(right) - probability(left))
  const candidate = ordered[0]
  if (candidate === undefined) throw new OperationRunError('runner constructed no candidates', 'RUNNER_INVARIANT')
  const top = probability(candidate)
  const runnerUpCandidate = ordered[1]
  const runnerUp = runnerUpCandidate === undefined ? 0 : probability(runnerUpCandidate)
  const uniqueTop = ordered.length < 2 || top > runnerUp
  const accepted = uniqueTop && top >= limits.minimumProbability && top - runnerUp >= limits.minimumMargin
  if (!accepted) {
    const replan = candidates.find(entry => entry.kind === 'needs-replan')
    if (replan === undefined) throw new OperationRunError('runner-owned replan candidate is missing', 'RUNNER_INVARIANT')
    return { candidate: replan, accepted: false, reason: 'distribution did not meet configured autonomous acceptance rule' }
  }
  return { candidate, accepted: candidate.kind === 'continue' || candidate.kind === 'complete', reason: 'distribution met configured autonomous acceptance rule' }
}

function summary(
  state: RunnerState,
  status: OperationStatus,
  reason: string,
  verification: readonly OperationAssertionResult[],
): OperationSummary {
  return { runId: state.runId, status, reason, attemptedSteps: state.attempted, completedSteps: state.completed, verification }
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function unreachable(value: never): never {
  throw new OperationRunError(`unsupported operation expression: ${JSON.stringify(value)}`, 'RUNNER_INVARIANT')
}
