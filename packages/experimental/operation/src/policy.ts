/**
 * Trusted operation eligibility and canonical process-outcome inspection.
 * @module @deepseek-ai/dsh-experimental-operation/policy
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Result of trusted post-policy canonical output inspection. */
export type OperationToolInspection =
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'incomplete'; readonly reason: string }

/** Immutable caller facts captured from the actual tool caller, never from plan arguments. */
export interface OperationToolCallerContext {
  /** Session workspace at this validation point; absent callers have no workspace fallback. */
  readonly cwd: string | undefined
}

/**
 * Trusted eligibility policy for one exact registered tool definition.
 */
export interface OperationToolPolicy {
  /** Whether result/selected references may influence arguments for this definition. */
  readonly allowOutputReferences: boolean
  /**
   * Reject arguments that select an unsupported execution mode before dispatch.
   * Normal tool schema and runtime policy validation remain authoritative.
   * @param args Concrete lossless JSON arguments.
   * @param caller Frozen snapshot of trusted caller facts, refreshed immediately before the body.
   */
  validateArguments(this: void, args: JsonValue, caller: OperationToolCallerContext): void
  /**
   * Classify the post-policy canonical result without consulting rendered output.
   * @param value Canonical tool value returned by the ordinary registry pipeline.
   * @returns Required completion, hard failure, or incomplete-evidence outcome.
   */
  inspectResult(this: void, value: JsonValue): OperationToolInspection
}

/** Trusted operation-policy registration or admission failure. */
export class OperationToolPolicyError extends Error {
  /**
   * @param message Stable registration or admission diagnostic.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationToolPolicyError'
  }
}

/**
 * Fail-closed registry of independently verified operation-safe definitions.
 *
 * Policies bind by object identity rather than tool name or schema. Replacing a
 * tool definition therefore removes eligibility until the replacement is
 * independently registered. This registry performs no dispatch and grants no
 * permission; every admitted call must still use the ordinary tool pipeline.
 */
export class OperationToolPolicyRegistry {
  private readonly policies = new WeakMap<ToolDefinition, OperationToolPolicy>()

  /**
   * Register trusted eligibility for one exact definition instance.
   * @param definition Exact registered definition reviewed for operation use.
   * @param policy Argument and canonical-result checks for that definition.
   * @returns Disposer removing only this exact registration.
   */
  register(definition: ToolDefinition, policy: OperationToolPolicy): () => void {
    if (this.policies.has(definition)) {
      throw new OperationToolPolicyError(`operation policy for tool ${JSON.stringify(definition.name)} is already registered`)
    }
    const registered = Object.freeze({
      allowOutputReferences: policy.allowOutputReferences,
      validateArguments: policy.validateArguments,
      inspectResult: policy.inspectResult,
    })
    this.policies.set(definition, registered)
    return () => {
      if (this.policies.get(definition) === registered) this.policies.delete(definition)
    }
  }

  /**
   * Require eligibility for the definition currently resolved by the tool registry.
   * @param definition Current exact visible definition.
   * @returns Its trusted operation policy.
   */
  require(definition: ToolDefinition): OperationToolPolicy {
    const policy = this.policies.get(definition)
    if (policy === undefined) {
      throw new OperationToolPolicyError(`tool ${JSON.stringify(definition.name)} has no trusted operation policy for this definition instance`)
    }
    return policy
  }
}

/** Configuration for foreground process canonical-result inspection. */
export interface ForegroundProcessPolicyOptions {
  /** Nonzero exit codes independently reviewed as expected for this registration. */
  readonly expectedNonzeroExitCodes?: readonly number[]
}

/**
 * Build lifecycle checks for the canonical foreground result shared by bash and pwsh.
 * These checks do not authorize commands or prove they are read-only. The ordinary
 * tool permission policy remains authoritative; read-only compositions additionally restrict invocations.
 * @param options Independently reviewed nonzero outcomes accepted by this registration.
 * @returns Argument admission and canonical process-result checks.
 */
export function createForegroundProcessOperationPolicy(
  options: ForegroundProcessPolicyOptions = {},
): OperationToolPolicy {
  const expectedNonzeroExitCodes = expectedCodes(options.expectedNonzeroExitCodes ?? [])
  return Object.freeze({
    allowOutputReferences: false,
    validateArguments(args: JsonValue): void {
      const record = jsonObject(args, 'process arguments')
      if (record.run_in_background === true) {
        throw new OperationToolPolicyError('operation process tools cannot run in the background')
      }
    },
    inspectResult(value: JsonValue): OperationToolInspection {
      return inspectForegroundProcessResult(value, expectedNonzeroExitCodes)
    },
  })
}

/**
 * Inspect one bash/pwsh canonical foreground result using structured facts only.
 * @param value Post-policy canonical process result.
 * @param expectedNonzeroExitCodes Trusted nonzero exit-code exceptions.
 * @returns Complete, mandatory failure, or incomplete-stream classification.
 */
export function inspectForegroundProcessResult(
  value: JsonValue,
  expectedNonzeroExitCodes: ReadonlySet<number> = new Set(),
): OperationToolInspection {
  const result = jsonObject(value, 'process result')
  if (result.kind === 'background') return failed('background process results are not completed work')
  if (result.kind !== 'foreground') return failed('process result kind must be foreground')

  const timedOut = jsonBoolean(result.timedOut, 'process result timedOut')
  const aborted = jsonBoolean(result.aborted, 'process result aborted')
  const signal = jsonNullableString(result.signal, 'process result signal')
  const exitCode = jsonNullableInteger(result.exitCode, 'process result exitCode')
  const stdout = stream(result.stdout, 'process result stdout')
  const stderr = stream(result.stderr, 'process result stderr')
  const sandbox = result.sandbox === undefined ? undefined : sandboxFacts(result.sandbox)

  if (timedOut) return failed('process timed out')
  if (aborted) return failed('process was aborted')
  if (signal !== null) return failed(`process terminated by signal ${JSON.stringify(signal)}`)
  if (sandbox?.denied === true) return failed('process sandbox denied execution')
  if (sandbox?.runnerFailed === true) return failed('process sandbox runner failed')
  if (exitCode === null) return failed('process did not report an exit code')
  if (exitCode !== 0 && !expectedNonzeroExitCodes.has(exitCode)) {
    return failed(`process exited with unexpected code ${exitCode}`)
  }
  if (stdout.truncated || stderr.truncated) return incomplete('process output is truncated')
  return { kind: 'complete' }
}

function expectedCodes(values: readonly number[]): ReadonlySet<number> {
  const result = new Set<number>()
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value === 0) {
      throw new OperationToolPolicyError('expected process exit codes must be nonzero safe integers')
    }
    result.add(value)
  }
  return result
}

function jsonObject(value: JsonValue, path: string): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationToolPolicyError(`${path} must be a JSON object`)
  }
  return value
}

function jsonBoolean(value: JsonValue | undefined, path: string): boolean {
  if (typeof value !== 'boolean') throw new OperationToolPolicyError(`${path} must be boolean`)
  return value
}

function jsonNullableString(value: JsonValue | undefined, path: string): string | null {
  if (value !== null && typeof value !== 'string') throw new OperationToolPolicyError(`${path} must be a string or null`)
  return value
}

function jsonNullableInteger(value: JsonValue | undefined, path: string): number | null {
  if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    throw new OperationToolPolicyError(`${path} must be a safe integer or null`)
  }
  return value
}

function stream(value: JsonValue | undefined, path: string): { readonly truncated: boolean } {
  const record = jsonObject(required(value, path), path)
  return { truncated: jsonBoolean(record.truncated, `${path}.truncated`) }
}

function sandboxFacts(value: JsonValue): { readonly denied: boolean; readonly runnerFailed: boolean } {
  const record = jsonObject(value, 'process result sandbox')
  const denied = jsonBoolean(record.denied, 'process result sandbox.denied')
  const runnerFailed = record.runnerFailed === undefined
    ? false
    : jsonBoolean(record.runnerFailed, 'process result sandbox.runnerFailed')
  return { denied, runnerFailed }
}

function required(value: JsonValue | undefined, path: string): JsonValue {
  if (value === undefined) throw new OperationToolPolicyError(`${path} is required`)
  return value
}

function failed(reason: string): OperationToolInspection {
  return { kind: 'failed', reason }
}

function incomplete(reason: string): OperationToolInspection {
  return { kind: 'incomplete', reason }
}
