/**
 * Opt-in bounded sequential operation tool, runner, durable records, and judgment seam.
 * @module @deepseek-ai/dsh-experimental-operation
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { OperationJudgmentRegistry } from './judgment.ts'
import { OperationToolPolicyRegistry } from './policy.ts'
import { OperationRunError, OperationRunner, type OperationConfig } from './runner.ts'
import { operationPlanParameters } from './plan-schema.ts'
import { resolveOperationRequest } from './plan.ts'
import type { OperationJudgmentProvider, OperationSummary, OperationTokenizer } from './types.ts'

export * from './types.ts'
export { OperationRunId, OperationJudgmentRequestId, OperationCandidateId } from './ids.ts'
export { OperationJudgmentError, OperationJudgmentRegistry } from './judgment.ts'
export { OperationJsonError, canonicalJson, digestJson, equalJson, jsonBytes, parseJsonPointer, resolveJsonPointer } from './json.ts'
export { OperationPlanError, parseOperationPlan, resolveOperationPlan, resolveOperationRequest } from './plan.ts'
export {
  createForegroundProcessOperationPolicy,
  inspectForegroundProcessResult,
  OperationToolPolicyError,
  OperationToolPolicyRegistry,
} from './policy.ts'
export type { ForegroundProcessPolicyOptions, OperationToolCallerContext, OperationToolInspection, OperationToolPolicy } from './policy.ts'
export { OperationEvidenceError, buildContinuationCandidates, completionControls, observeCanonicalResult, withIntermediateControls } from './observation.ts'
export { OperationRecordingError, OperationRecorder } from './recorder.ts'
export { OperationResolutionError, assertionsPassed, evaluateOperationAssertions, resolveOperationExpression } from './resolution.ts'
export { OperationReplayError, replayOperation } from './replay.ts'
export { DEFAULT_OPERATION_LIMITS, OperationRunError, OperationRunner, resolveOperationLimits } from './runner.ts'
export type { OperationConfig } from './runner.ts'
export type { OperationReplay, OperationReplayJudgment, OperationReplayStatus, OperationReplayStep } from './replay.ts'
export type { OperationResolution, OperationResolutionContext } from './resolution.ts'

/**

 * Cordis service exposing the operation runner and provider registration seam.

 */
export class OperationService extends Service {
  static inject = ['tools', 'sessions']

  /**

   * Loader schema for every resolved operation limit and additional excluded tool.

   */
  static Config: z<OperationConfig> = z.object({
    returnObservations: z.boolean().default(false),
    maxReturnedObservationBytes: z.natural().min(1).default(65_536),
    maxPlanBytes: z.natural().min(1).default(65_536),
    maxSteps: z.natural().min(1).default(12),
    maxWallMs: z.natural().min(1).default(120_000),
    maxToolDeadlineMs: z.natural().min(1).default(30_000),
    maxJudgmentDeadlineMs: z.natural().min(1).default(15_000),
    maxToolCalls: z.natural().min(1).default(12),
    maxJudgments: z.natural().min(1).default(12),
    maxResultBytes: z.natural().min(1).default(262_144),
    maxObservationBytes: z.natural().min(1).default(65_536),
    maxCandidates: z.natural().min(1).default(16),
    maxCandidateBytes: z.natural().min(1).default(8_192),
    maxJudgmentInputTokens: z.natural().min(1).default(16_384),
    maxJudgmentOutputTokens: z.natural().min(1).default(1_024),
    minimumProbability: z.number().min(0).max(1).default(0.7),
    minimumMargin: z.number().min(0).max(1).default(0.1),
    requireCalibration: z.boolean().default(true),
    forbiddenTools: z.array(z.string()).default([]),
  })

  /**

   * Narrow ranking provider registry owned by this operation composition.

   */
  readonly judgments: OperationJudgmentRegistry
  /** Trusted operation eligibility keyed by exact registered tool definition. */
  readonly toolPolicies: OperationToolPolicyRegistry
  private readonly runner: OperationRunner
  private readonly active = new Map<AbortController, Promise<unknown>>()
  private closing = false

  /**

   * @param ctx Owning Cordis context.

   * @param config Resolved deployment limits.

   */
  constructor(ctx: Context, config: OperationConfig = {}) {
    super(ctx, 'operations')
    this.judgments = new OperationJudgmentRegistry(ctx)
    this.toolPolicies = new OperationToolPolicyRegistry()
    this.runner = new OperationRunner(ctx, this.judgments, this.toolPolicies, config)
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'run_operation',
      description: 'Run a tool through the decision flow. For one action, supply tool and its ordinary arguments; goal is optional. Use plan only for a fixed sequence. Make this the only tool call in the response. Ordinary permissions apply. Actions run in the foreground. A decision failure does not undo an executed action: use returned observations and completedSteps, follow next, and never automatically repeat a mutation.',
      parameters: operationPlanParameters,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            observations: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  step: { type: 'string', required: true },
                  pointer: { type: 'string', required: true },
                  value: { type: 'json', required: true },
                },
              },
            },
            runId: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['completed', 'needs-replan', 'stopped', 'failed', 'cancelled'] },
            reason: { type: 'string', required: true },
            next: { type: 'string', required: true },
            attemptedSteps: { type: 'array', required: true, items: { type: 'string' } },
            completedSteps: { type: 'array', required: true, items: { type: 'string' } },
            verification: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  index: { type: 'integer', required: true },
                  passed: { type: 'boolean', required: true },
                  reason: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => this.runTool(exec, resolveOperationRequest(args)),
    })), 'operation.runOperationTool()')
    ctx.effect(() => async () => {
      this.closing = true
      for (const controller of this.active.keys()) controller.abort(new Error('operation service is disposing'))
      await Promise.allSettled(this.active.values())
    }, 'operation.drainRuns()')
  }

  /**

   * Register the single configured judgment provider.

   * @param provider Bounded ranking provider.

   * @returns Disposer removing this exact provider.

   */
  registerJudgmentProvider(provider: OperationJudgmentProvider): () => void {
    return this.judgments.registerProvider(provider)
  }

  /**

   * Register one exact tokenizer provider available to CLM adapters.

   * @param tokenizer Tokenizer hook.

   * @returns Disposer removing this exact tokenizer.

   */
  registerTokenizer(tokenizer: OperationTokenizer): () => void {
    return this.judgments.registerTokenizer(tokenizer)
  }

  /**

   * Execute one operation under the outer tool lifecycle.

   * @param exec Outer tool execution.

   * @param plan Raw plan.

   * @returns Non-failure terminal summary.

   */
  async run(exec: ToolRunContext, plan: unknown): Promise<OperationSummary> {
    if (this.closing) throw new Error('operation service is disposing')
    const controller = new AbortController()
    const run = Promise.resolve().then(async () => await this.runner.run({
      ...exec,
      signal: AbortSignal.any([exec.signal, controller.signal]),
      concludeTurn: exec.concludeTurn.bind(exec),
      deferContext: exec.deferContext.bind(exec),
    }, plan))
    this.active.set(controller, run)
    try {
      return await run
    } finally {
      this.active.delete(controller)
    }
  }

  private async runTool(exec: ToolRunContext, plan: unknown) {
    let summary: OperationSummary
    try {
      summary = await this.run(exec, plan)
    } catch (error: unknown) {
      if (!(error instanceof OperationRunError) || error.summary === undefined) throw error
      // Keep the tool failure while preserving durably completed evidence for the caller.
      throw new OperationRunError(JSON.stringify({ ...error.summary, next: nextAction(error.summary) }), error.code)
    }
    return {
      runId: summary.runId,
      status: summary.status,
      reason: summary.reason,
      next: nextAction(summary),
      attemptedSteps: [...summary.attemptedSteps],
      completedSteps: [...summary.completedSteps],
      verification: summary.verification.map(result => ({ index: result.index, passed: result.passed, reason: result.reason })),
      ...(summary.observations === undefined ? {} : { observations: summary.observations.map(observation => ({ ...observation })) }),
    }
  }
}

function nextAction(summary: OperationSummary): string {
  if (summary.status === 'completed') return 'Use the returned output to continue the task or answer the user.'
  if (summary.completedSteps.length > 0) {
    return 'Completed steps already ran. Use their returned observations; answer if sufficient, otherwise request only missing facts. This operation is not certified complete. Do not repeat completed mutations or try to raise limits.'
  }
  return 'The operation did not complete. Inspect the reason and attemptedSteps before acting; an attempted mutation may have taken effect. Do not retry it automatically or try to raise limits.'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    operations: OperationService
  }
}

export default OperationService
