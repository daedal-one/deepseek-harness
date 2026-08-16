/**
 * Optional one-shot result validation contributed to the subagent capability.
 * Validators inspect a completed child result at the model-facing delegation
 * consumer boundary. They report structured warnings and never replace the
 * child's output.
 *
 * @module @deepseek-ai/dsh-subagent/result-validation
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from './types.ts'

/** One stable, model-visible concern about a completed child result. */
export interface SubagentResultWarning {
  /** Stable machine-readable warning kind. */
  readonly code: string
  /** Safe explanation shown to the parent model. */
  readonly message: string
  /** Optional lossless detail for programmatic consumers. */
  readonly details?: JsonValue
}

/** Inputs available after a one-shot child has settled and before its tool result is returned. */
export interface SubagentResultValidationRequest {
  /** Role-specific contract selected by the tool instance. */
  readonly role: string
  /** Display label supplied with the delegation request. */
  readonly label: string
  /** Exact delegating parent. */
  readonly parent: Agent
  /** Published run, including the child Agent when it is in-process. */
  readonly run: SubagentRun
  /** Completed child outcome to inspect without mutation. */
  readonly result: SubagentResult
}

/** Named deployment policy for validating one completed one-shot result. */
export interface SubagentResultValidator {
  /** Unique registry name selected by a delegation tool instance. */
  readonly name: string
  /**
   * Inspect one result and return concerns without discarding useful output.
   * @param request - completed result and trusted delegation context.
   * @returns structured warnings in display order.
   */
  validate(request: SubagentResultValidationRequest): Promise<readonly SubagentResultWarning[]>
}
