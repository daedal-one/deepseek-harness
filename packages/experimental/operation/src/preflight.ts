/**
 * Conservative impossibility checks for admitted operation plans. Unknown schemas
 * and potentially absent optional values remain subject to concrete validation.
 * @module @deepseek-ai/dsh-experimental-operation/preflight
 */

import { assertSupportedJsonSchema, JsonSchemaError, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode, JsonSchemaType, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { assertNever, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { equalJson, parseJsonPointer } from './json.ts'
import { OperationPlanError } from './plan.ts'
import { evaluateOperationAssertions, resolveOperationExpression } from './resolution.ts'
import type { OperationAssertion, OperationExpression, OperationPlan } from './types.ts'

type Value =
  | { readonly kind: 'known'; readonly value: JsonValue }
  | { readonly kind: 'schemas'; readonly alternatives: readonly JsonSchemaNode[] }
  | { readonly kind: 'object'; readonly properties: ReadonlyMap<string, Value> }
  | { readonly kind: 'array'; readonly items: readonly Value[] }

const UNKNOWN: JsonSchemaNode = {}

/**
 * Reject only contradictions established by admitted tool schemas or known plan
 * values, before recording or dispatch. This is not a substitute for validating
 * concrete arguments, assertions, evidence, and canonical results at runtime.
 * @param plan Parsed backward-only plan.
 * @param admitted Exact definitions already admitted for every step.
 * @returns Nothing when no supported check proves the plan impossible.
 */
export function preflightOperationPlan(
  plan: OperationPlan,
  admitted: ReadonlyMap<string, { readonly definition: ToolDefinition }>,
): void {
  const outputs = new Map<string, JsonSchemaNode>()
  const inputs = new Map<string, JsonSchemaNode>()
  const selections = new Map<string, readonly JsonSchemaNode[]>()
  for (const step of plan.steps) {
    const entry = admitted.get(step.id)
    if (entry === undefined) throw new OperationPlanError(`step ${JSON.stringify(step.id)} has no admitted definition`)
    outputs.set(step.id, supported(entry.definition.output.schema))
    inputs.set(step.id, supported(entry.definition.parameters))
  }

  const resultSchemas = (step: string, pointer: string): readonly JsonSchemaNode[] =>
    atPointer([outputs.get(step) ?? UNKNOWN], pointer, `result ${JSON.stringify(step)}`)

  const selectedSchemas = (step: string): readonly JsonSchemaNode[] => {
    const cached = selections.get(step)
    if (cached !== undefined) return cached
    const pointer = plan.steps.find(source => source.id === step)?.observation.candidates
    if (pointer === undefined) throw new OperationPlanError(`selected source ${JSON.stringify(step)} has no candidate collection`)
    const items = resultSchemas(step, pointer).flatMap(schema => branches(schema).flatMap((branch) => {
      if (branch.type === undefined) return [UNKNOWN]
      return branch.type === 'array' ? [branch.items ?? UNKNOWN] : []
    }))
    if (items.length === 0) throw new OperationPlanError(`candidate collection ${JSON.stringify(step + pointer)} cannot be an array`)
    selections.set(step, items)
    return items
  }

  const infer = (expression: OperationExpression): Value => {
    switch (expression.kind) {
      case 'literal':
      case 'input':
        return { kind: 'known', value: resolveOperationExpression(expression, { inputs: plan.inputs, results: new Map() }).value }
      case 'result':
        return { kind: 'schemas', alternatives: resultSchemas(expression.step, expression.pointer) }
      case 'selected':
        return {
          kind: 'schemas',
          alternatives: atPointer(selectedSchemas(expression.step), expression.pointer, `selected record from ${JSON.stringify(expression.step)}`),
        }
      case 'object': {
        const properties = new Map(Object.entries(expression.properties).map(([key, nested]) => [key, infer(nested)]))
        const known: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
        for (const [key, value] of properties) {
          if (value.kind !== 'known') return { kind: 'object', properties }
          known[key] = value.value
        }
        return { kind: 'known', value: known }
      }
      case 'array': {
        const items = expression.items.map(infer)
        return items.every(value => value.kind === 'known')
          ? { kind: 'known', value: items.map(value => value.value) }
          : { kind: 'array', items }
      }
      default:
        return assertNever(expression)
    }
  }

  for (const step of plan.steps) {
    const label = `step ${JSON.stringify(step.id)}`
    if (!canFit(infer(step.arguments), inputs.get(step.id) ?? UNKNOWN)) {
      throw new OperationPlanError(`${label} arguments cannot satisfy its input schema`)
    }
    checkAssertions(step.assertions, infer, label)
    for (const pointer of step.observation.paths) resultSchemas(step.id, pointer)
    if (step.observation.candidates !== undefined) resultSchemas(step.id, step.observation.candidates)
  }
  checkAssertions(plan.completion.assertions, infer, 'completion')
  for (const expression of plan.completion.evidence) infer(expression)
}

function supported(schema: unknown): JsonSchemaNode {
  try {
    assertSupportedJsonSchema(schema)
  } catch (error: unknown) {
    // Only the maintained subset supplies proof; boolean schemas, refs, and other
    // unsupported forms do not authorize an admission rejection here.
    if (error instanceof JsonSchemaError) return UNKNOWN
    throw error
  }
  return schema
}

function branches(schema: JsonSchemaNode): readonly JsonSchemaNode[] {
  // oneOf branches are an overapproximation, not a synthetic exact-one schema:
  // overlapping possibilities must never make a valid reference impossible.
  return schema.oneOf === undefined ? [schema] : schema.oneOf.flatMap(branches)
}

function atPointer(schemas: readonly JsonSchemaNode[], pointer: string, label: string): readonly JsonSchemaNode[] {
  let current = schemas
  for (const segment of parseJsonPointer(pointer)) {
    current = current.flatMap(schema => branches(schema).flatMap((branch) => {
      if (branch.type === undefined) return [UNKNOWN]
      if (branch.type === 'object') {
        const child = ownProperty(branch, segment)
        if (child !== undefined) return [child]
        return branch.additionalProperties === false ? [] : [UNKNOWN]
      }
      if (branch.type === 'array' && /^(0|[1-9][0-9]*)$/u.test(segment) && Number.isSafeInteger(Number(segment))) {
        return [branch.items ?? UNKNOWN]
      }
      return []
    }))
  }
  if (current.length === 0) throw new OperationPlanError(`${label} JSON Pointer ${JSON.stringify(pointer)} is impossible under its output schema`)
  return current
}

function ownProperty(schema: JsonSchemaNode, key: string): JsonSchemaNode | undefined {
  return schema.properties !== undefined && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
}

function canFit(value: Value, schema: JsonSchemaNode): boolean {
  if (value.kind === 'known') return validateJsonSchemaValue(schema, value.value).length === 0
  if (schema.oneOf !== undefined) return schema.oneOf.some(branch => canFit(value, branch))
  if (value.kind === 'schemas') return value.alternatives.some(source => !disjoint(source, schema))
  if (schema.type === undefined) return true
  if (schema.type !== value.kind) return false
  if (value.kind === 'array') return value.items.every(item => canFit(item, schema.items ?? UNKNOWN))
  if (schema.required?.some(key => !value.properties.has(key))) return false
  return [...value.properties].every(([key, nested]) => {
    const child = ownProperty(schema, key)
    return child === undefined ? schema.additionalProperties !== false : canFit(nested, child)
  })
}

function typesOverlap(left: JsonSchemaType, right: JsonSchemaType): boolean {
  return left === right || (left === 'integer' && right === 'number') || (left === 'number' && right === 'integer')
}

function disjoint(left: JsonSchemaNode, right: JsonSchemaNode): boolean {
  if (left.oneOf !== undefined) return left.oneOf.every(branch => disjoint(branch, right))
  if (right.oneOf !== undefined) return right.oneOf.every(branch => disjoint(left, branch))
  if (left.type === undefined || right.type === undefined) return false
  if (!typesOverlap(left.type, right.type)) return true
  const leftValues = scalarValues(left)
  if (leftValues !== undefined) return leftValues.every(value => validateJsonSchemaValue(right, value).length > 0)
  const rightValues = scalarValues(right)
  if (rightValues !== undefined) return rightValues.every(value => validateJsonSchemaValue(left, value).length > 0)
  if (left.type !== 'object' || right.type !== 'object') return false
  // Optional properties do not prove disjointness: both objects may omit them.
  return [...new Set([...(left.required ?? []), ...(right.required ?? [])])].some((key) => {
    const leftChild = ownProperty(left, key)
    const rightChild = ownProperty(right, key)
    if (leftChild === undefined && left.additionalProperties === false) return true
    if (rightChild === undefined && right.additionalProperties === false) return true
    return leftChild !== undefined && rightChild !== undefined && disjoint(leftChild, rightChild)
  })
}

function scalarValues(schema: JsonSchemaNode): readonly JsonValue[] | undefined {
  if (schema.const !== undefined) return [schema.const]
  return schema.enum
}

function canEqual(value: Value, candidate: JsonValue): boolean {
  switch (value.kind) {
    case 'known':
      return equalJson(value.value, candidate)
    case 'schemas':
      return value.alternatives.some(schema => validateJsonSchemaValue(schema, candidate).length === 0)
    case 'array':
      return Array.isArray(candidate) && candidate.length === value.items.length
        && value.items.every((item, index) => {
          const nested = candidate[index]
          return nested !== undefined && canEqual(item, nested)
        })
    case 'object':
      return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
        && Object.keys(candidate).length === value.properties.size
        && [...value.properties].every(([key, nested]) => {
          const property = candidate[key]
          return Object.hasOwn(candidate, key) && property !== undefined && canEqual(nested, property)
        })
    default:
      return assertNever(value)
  }
}

function possibleTypes(value: Value): readonly JsonSchemaType[] {
  switch (value.kind) {
    case 'known':
      if (value.value === null) return ['null']
      if (Array.isArray(value.value)) return ['array']
      return [typeof value.value as 'object' | 'string' | 'number' | 'boolean']
    case 'object':
    case 'array':
      return [value.kind]
    case 'schemas':
      return value.alternatives.flatMap(schema => branches(schema).flatMap(branch => branch.type === undefined
        ? ['object', 'array', 'string', 'number', 'boolean', 'null'] as const
        : [branch.type]))
    default:
      return assertNever(value)
  }
}

function checkAssertions(
  assertions: readonly OperationAssertion[],
  infer: (expression: OperationExpression) => Value,
  label: string,
): void {
  for (const [index, assertion] of assertions.entries()) {
    if (!assertionPossible(assertion, infer)) throw new OperationPlanError(`${label} assertion ${index} cannot pass under its declared values and schemas`)
  }
}

function assertionPossible(assertion: OperationAssertion, infer: (expression: OperationExpression) => Value): boolean {
  if (assertion.kind === 'equals') {
    const left = infer(assertion.left)
    const right = infer(assertion.right)
    if (left.kind === 'known') return canEqual(right, left.value)
    if (right.kind === 'known') return canEqual(left, right.value)
    return possibleTypes(left).some(type => possibleTypes(right).some(other => typesOverlap(type, other)))
  }
  const value = infer(assertion.value)
  if (value.kind === 'known') {
    return evaluateOperationAssertions([{ ...assertion, value: { kind: 'literal', value: value.value } }], { inputs: {}, results: new Map() })[0]?.passed === true
  }
  switch (assertion.kind) {
    case 'present':
      return true
    case 'type':
      return canFit(value, { type: assertion.type })
    case 'oneOf':
      return assertion.values.some(candidate => canEqual(value, candidate))
    case 'number':
      return canFit(value, { type: 'number' })
    case 'size':
      return ['string', 'array', 'object'].some(type => possibleTypes(value).includes(type as JsonSchemaType))
    default:
      return assertNever(assertion)
  }
}
