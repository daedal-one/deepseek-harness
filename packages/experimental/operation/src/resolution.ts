/**
 * Typed operation-expression resolution and deterministic assertion evaluation.
 * @module @deepseek-ai/dsh-experimental-operation/resolution
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { equalJson, resolveJsonPointer } from './json.ts'
import type {
  OperationAssertion,
  OperationAssertionResult,
  OperationExpression,
  OperationJsonType,
  OperationValueProvenance,
} from './types.ts'

/**

 * Values available while resolving one step or completion check.

 */
export interface OperationResolutionContext {
  /**
   * Immutable parsed input values.
   */
  readonly inputs: Readonly<Record<string, JsonValue>>
  /**
   * Canonical outputs keyed by completed step id.
   */
  readonly results: ReadonlyMap<string, JsonValue>
  /**
   * Selected complete record keyed by preceding step id.
   */
  readonly selected?: ReadonlyMap<string, JsonValue>
}

/**

 * Fully resolved JSON expression and exact leaf provenance.

 */
export interface OperationResolution {
  /**
   * Complete detached JSON value.
   */
  readonly value: JsonValue
  /**
   * Every non-composite source read while resolving.
   */
  readonly provenance: readonly OperationValueProvenance[]
}

/**

 * Resolution failure that preserves missing versus explicit null semantics.

 */
export class OperationResolutionError extends Error {
  /**
   * @param message Stable missing/type/source diagnostic.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationResolutionError'
  }
}

/**

 * Resolve one expression without coercion, interpolation, or host-property access.

 * @param expression Trusted parsed expression.

 * @param context Completed canonical values.

 * @returns Complete value plus provenance.

 */
export function resolveOperationExpression(expression: OperationExpression, context: OperationResolutionContext): OperationResolution {
  switch (expression.kind) {
    case 'literal':
      return { value: expression.value, provenance: [{ kind: 'literal' }] }
    case 'input': {
      const source = context.inputs[expression.input]
      if (source === undefined) {
        if (!Object.hasOwn(context.inputs, expression.input)) throw new OperationResolutionError(`missing input ${JSON.stringify(expression.input)}`)
        throw new OperationResolutionError(`input ${JSON.stringify(expression.input)} is not JSON`)
      }
      return resolvePointer(source, expression.pointer, { kind: 'input', input: expression.input, pointer: expression.pointer })
    }
    case 'result': {
      const source = context.results.get(expression.step)
      if (source === undefined) throw new OperationResolutionError(`missing canonical result for step ${JSON.stringify(expression.step)}`)
      return resolvePointer(source, expression.pointer, { kind: 'result', step: expression.step, pointer: expression.pointer })
    }
    case 'selected': {
      const source = context.selected?.get(expression.step)
      if (source === undefined) throw new OperationResolutionError(`missing selected record for step ${JSON.stringify(expression.step)}`)
      return resolvePointer(source, expression.pointer, { kind: 'selected', step: expression.step, pointer: expression.pointer })
    }
    case 'object': {
      const value: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
      const provenance: OperationValueProvenance[] = []
      for (const [key, nested] of Object.entries(expression.properties)) {
        const resolved = resolveOperationExpression(nested, context)
        value[key] = resolved.value
        provenance.push(...resolved.provenance)
      }
      return { value, provenance }
    }
    case 'array': {
      const value: JsonValue[] = []
      const provenance: OperationValueProvenance[] = []
      for (const nested of expression.items) {
        const resolved = resolveOperationExpression(nested, context)
        value.push(resolved.value)
        provenance.push(...resolved.provenance)
      }
      return { value, provenance }
    }
    default:
      return unreachable(expression)
  }
}

/**

 * Evaluate every mandatory assertion without turning resolution failures into truthy values.

 * @param assertions Parsed assertions.

 * @param context Available canonical values.

 * @returns Ordered deterministic assertion outcomes.

 */
export function evaluateOperationAssertions(
  assertions: readonly OperationAssertion[],
  context: OperationResolutionContext,
): readonly OperationAssertionResult[] {
  return assertions.map((assertion, index) => {
    try {
      return evaluateAssertion(assertion, context, index)
    } catch (error: unknown) {
      return { index, passed: false, reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

/**

 * Whether every assertion passed.

 * @param results Ordered assertion outcomes.

 * @returns Whether every required check passed.

 */
export function assertionsPassed(results: readonly OperationAssertionResult[]): boolean {
  return results.every(result => result.passed)
}

function resolvePointer(value: JsonValue, pointer: string, provenance: OperationValueProvenance): OperationResolution {
  const result = resolveJsonPointer(value, pointer)
  if (!result.found) throw new OperationResolutionError(`missing JSON Pointer ${JSON.stringify(pointer)}`)
  return { value: result.value, provenance: [provenance] }
}

function evaluateAssertion(
  assertion: OperationAssertion,
  context: OperationResolutionContext,
  index: number,
): OperationAssertionResult {
  switch (assertion.kind) {
    case 'present': {
      resolveOperationExpression(assertion.value, context)
      return pass(index)
    }
    case 'type': {
      const value = resolveOperationExpression(assertion.value, context).value
      const passed = jsonTypeOf(value) === assertion.type
      return checked(index, passed, `expected ${assertion.type}, got ${jsonTypeOf(value)}`)
    }
    case 'equals': {
      const left = resolveOperationExpression(assertion.left, context).value
      const right = resolveOperationExpression(assertion.right, context).value
      return checked(index, equalJson(left, right), 'expected values to be exactly equal')
    }
    case 'oneOf': {
      const value = resolveOperationExpression(assertion.value, context).value
      return checked(index, assertion.values.some(candidate => equalJson(candidate, value)), 'value is not in declared finite set')
    }
    case 'number': {
      const value = resolveOperationExpression(assertion.value, context).value
      if (typeof value !== 'number') return checked(index, false, 'expected a number')
      const passed = (assertion.min === undefined || value >= assertion.min) && (assertion.max === undefined || value <= assertion.max)
      return checked(index, passed, `number is outside declared bounds${bounds(assertion.min, assertion.max)}`)
    }
    case 'size': {
      const value = resolveOperationExpression(assertion.value, context).value
      const size = Array.isArray(value) || typeof value === 'string'
        ? value.length
        : value !== null && typeof value === 'object'
          ? Object.keys(value).length
          : undefined
      if (size === undefined) return checked(index, false, 'expected string, array, or object with a size')
      const passed = (assertion.min === undefined || size >= assertion.min) && (assertion.max === undefined || size <= assertion.max)
      return checked(index, passed, `size is outside declared bounds${bounds(assertion.min, assertion.max)}`)
    }
    default:
      return unreachable(assertion)
  }
}

function jsonTypeOf(value: JsonValue): OperationJsonType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'string'
}

function pass(index: number): OperationAssertionResult {
  return { index, passed: true, reason: 'passed' }
}

function checked(index: number, passed: boolean, reason: string): OperationAssertionResult {
  return { index, passed, reason: passed ? 'passed' : reason }
}

function bounds(min: number | undefined, max: number | undefined): string {
  return ` [${min === undefined ? '-∞' : String(min)}, ${max === undefined ? '∞' : String(max)}]`
}

function unreachable(value: never): never {
  throw new OperationResolutionError(`unsupported operation variant: ${JSON.stringify(value)}`)
}
