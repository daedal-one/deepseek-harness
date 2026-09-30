/**
 * Version-one operation-plan parser and static reference validation.
 * @module @deepseek-ai/dsh-experimental-operation/plan
 */

import { deepFreeze, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { OperationJsonError, parseJsonPointer, requireJson } from './json.ts'
import type {
  OperationAssertion,
  OperationCompletion,
  OperationExpression,
  OperationJsonType,
  OperationLimits,
  OperationObservationSpec,
  OperationPlan,
  OperationStep,
} from './types.ts'

const LIMIT_KEYS = [
  'maxPlanBytes', 'maxSteps', 'maxWallMs', 'maxToolDeadlineMs', 'maxJudgmentDeadlineMs',
  'maxToolCalls', 'maxJudgments', 'maxResultBytes', 'maxObservationBytes', 'maxCandidates',
  'maxCandidateBytes', 'maxJudgmentInputTokens', 'maxJudgmentOutputTokens', 'minimumProbability',
  'minimumMargin', 'requireCalibration',
] as const satisfies readonly (keyof OperationLimits)[]

/**

 * Parse and statically validate version-one operation plan JSON.

 * @param raw Untrusted tool argument value.

 * @returns Immutable trusted plan.

 */
export function parseOperationPlan(raw: unknown): OperationPlan {
  const record = object(raw, 'plan')
  exact(record, ['version', 'name', 'goal', 'inputs', 'steps', 'completion', 'requestedLimits'], 'plan')
  if (record.version !== 1) throw new OperationPlanError('plan.version must equal 1')
  const inputs = objectJson(record.inputs, 'plan.inputs')
  const steps = array(record.steps, 'plan.steps').map((value, index) => parseStep(value, `plan.steps[${index}]`))
  if (steps.length === 0) throw new OperationPlanError('plan.steps must be non-empty')
  const completion = parseCompletion(record.completion, 'plan.completion')
  const plan: OperationPlan = {
    version: 1,
    name: string(record.name, 'plan.name'),
    goal: string(record.goal, 'plan.goal'),
    inputs,
    steps,
    completion,
    ...(record.requestedLimits === undefined ? {} : { requestedLimits: parseRequestedLimits(record.requestedLimits) }),
  }
  validateReferences(plan)
  return deepFreeze(plan)
}

/**

 * Boundary error for invalid operation-plan syntax or static references.

 */
export class OperationPlanError extends Error {
  /**
   * @param message Stable plan rejection detail.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationPlanError'
  }
}

function parseStep(raw: unknown, path: string): OperationStep {
  const record = object(raw, path)
  exact(record, ['id', 'purpose', 'tool', 'arguments', 'assertions', 'observation', 'question'], path)
  const assertions = array(record.assertions, `${path}.assertions`).map((value, index) => parseAssertion(value, `${path}.assertions[${index}]`))
  if (assertions.length === 0) throw new OperationPlanError(`${path}.assertions must be non-empty`)
  return {
    id: string(record.id, `${path}.id`),
    purpose: string(record.purpose, `${path}.purpose`),
    tool: string(record.tool, `${path}.tool`),
    arguments: parseExpression(record.arguments, `${path}.arguments`),
    assertions,
    observation: parseObservation(record.observation, `${path}.observation`),
    question: string(record.question, `${path}.question`),
  }
}

function parseCompletion(raw: unknown, path: string): OperationCompletion {
  const record = object(raw, path)
  exact(record, ['assertions', 'evidence', 'question'], path)
  const assertions = array(record.assertions, `${path}.assertions`).map((value, index) => parseAssertion(value, `${path}.assertions[${index}]`))
  const evidence = array(record.evidence, `${path}.evidence`).map((value, index) => parseExpression(value, `${path}.evidence[${index}]`))
  if (assertions.length === 0) throw new OperationPlanError(`${path}.assertions must be non-empty`)
  if (evidence.length === 0) throw new OperationPlanError(`${path}.evidence must be non-empty`)
  return { assertions, evidence, question: string(record.question, `${path}.question`) }
}

function parseObservation(raw: unknown, path: string): OperationObservationSpec {
  const record = object(raw, path)
  exact(record, ['paths', 'candidates'], path)
  const paths = array(record.paths, `${path}.paths`).map((value, index) => pointer(value, `${path}.paths[${index}]`))
  if (paths.length === 0) throw new OperationPlanError(`${path}.paths must be non-empty`)
  if (new Set(paths).size !== paths.length) throw new OperationPlanError(`${path}.paths must not contain duplicates`)
  return {
    paths,
    ...(record.candidates === undefined ? {} : { candidates: pointer(record.candidates, `${path}.candidates`) }),
  }
}

function parseExpression(raw: unknown, path: string): OperationExpression {
  const record = object(raw, path)
  const kind = string(record.kind, `${path}.kind`)
  switch (kind) {
    case 'literal':
      exact(record, ['kind', 'value'], path)
      return { kind, value: json(record.value, `${path}.value`) }
    case 'input':
      exact(record, ['kind', 'input', 'pointer'], path)
      return { kind, input: string(record.input, `${path}.input`), pointer: pointer(record.pointer, `${path}.pointer`) }
    case 'result':
    case 'selected':
      exact(record, ['kind', 'step', 'pointer'], path)
      return { kind, step: string(record.step, `${path}.step`), pointer: pointer(record.pointer, `${path}.pointer`) }
    case 'object': {
      exact(record, ['kind', 'properties'], path)
      const properties = object(record.properties, `${path}.properties`)
      const parsed: Record<string, OperationExpression> = Object.create(null) as Record<string, OperationExpression>
      for (const [key, value] of Object.entries(properties)) parsed[key] = parseExpression(value, `${path}.properties.${key}`)
      return { kind, properties: parsed }
    }
    case 'array':
      exact(record, ['kind', 'items'], path)
      return { kind, items: array(record.items, `${path}.items`).map((value, index) => parseExpression(value, `${path}.items[${index}]`)) }
    default:
      throw new OperationPlanError(`${path}.kind is unsupported: ${JSON.stringify(kind)}`)
  }
}

function parseAssertion(raw: unknown, path: string): OperationAssertion {
  const record = object(raw, path)
  const kind = string(record.kind, `${path}.kind`)
  switch (kind) {
    case 'present':
      exact(record, ['kind', 'value'], path)
      return { kind, value: parseExpression(record.value, `${path}.value`) }
    case 'type':
      exact(record, ['kind', 'value', 'type'], path)
      return { kind, value: parseExpression(record.value, `${path}.value`), type: jsonType(record.type, `${path}.type`) }
    case 'equals':
      exact(record, ['kind', 'left', 'right'], path)
      return { kind, left: parseExpression(record.left, `${path}.left`), right: parseExpression(record.right, `${path}.right`) }
    case 'oneOf': {
      exact(record, ['kind', 'value', 'values'], path)
      const values = array(record.values, `${path}.values`).map((value, index) => json(value, `${path}.values[${index}]`))
      if (values.length === 0) throw new OperationPlanError(`${path}.values must be non-empty`)
      return { kind, value: parseExpression(record.value, `${path}.value`), values }
    }
    case 'number':
    case 'size': {
      exact(record, ['kind', 'value', 'min', 'max'], path)
      const min = record.min === undefined ? undefined : finite(record.min, `${path}.min`)
      const max = record.max === undefined ? undefined : finite(record.max, `${path}.max`)
      if (min === undefined && max === undefined) throw new OperationPlanError(`${path} requires min or max`)
      if (min !== undefined && max !== undefined && min > max) throw new OperationPlanError(`${path}.min must not exceed max`)
      return {
        kind,
        value: parseExpression(record.value, `${path}.value`),
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
      }
    }
    default:
      throw new OperationPlanError(`${path}.kind is unsupported: ${JSON.stringify(kind)}`)
  }
}

function parseRequestedLimits(raw: unknown): Partial<OperationLimits> {
  const record = object(raw, 'plan.requestedLimits')
  exact(record, LIMIT_KEYS, 'plan.requestedLimits')
  const parsed: { -readonly [Key in keyof OperationLimits]?: OperationLimits[Key] } = {}
  for (const key of LIMIT_KEYS) {
    const value = record[key]
    if (value === undefined) continue
    if (key === 'requireCalibration') {
      if (typeof value !== 'boolean') throw new OperationPlanError('plan.requestedLimits.requireCalibration must be boolean')
      parsed.requireCalibration = value
      continue
    }
    const number = finite(value, `plan.requestedLimits.${key}`)
    if (key === 'minimumProbability' || key === 'minimumMargin') {
      if (number < 0 || number > 1) throw new OperationPlanError(`plan.requestedLimits.${key} must be within [0, 1]`)
    } else if (!Number.isSafeInteger(number) || number < 1) {
      throw new OperationPlanError(`plan.requestedLimits.${key} must be a positive safe integer`)
    }
    Object.assign(parsed, { [key]: number })
  }
  return parsed
}

function validateReferences(plan: OperationPlan): void {
  const stepIndexes = new Map<string, number>()
  for (const [index, step] of plan.steps.entries()) {
    if (stepIndexes.has(step.id)) throw new OperationPlanError(`plan.steps has duplicate id ${JSON.stringify(step.id)}`)
    stepIndexes.set(step.id, index)
  }
  for (const [index, step] of plan.steps.entries()) {
    validateExpression(step.arguments, plan, stepIndexes, index, false, `plan.steps[${index}].arguments`)
    for (const [assertionIndex, assertion] of step.assertions.entries()) {
      for (const [expressionIndex, expression] of assertionExpressions(assertion).entries()) {
        validateExpression(expression, plan, stepIndexes, index, true, `plan.steps[${index}].assertions[${assertionIndex}][${expressionIndex}]`)
      }
    }
    const selectedSteps = selectedSources(step.arguments)
    if (selectedSteps.size > 1) throw new OperationPlanError(`plan.steps[${index}].arguments selects from multiple source collections`)
    if (selectedSteps.size === 1) {
      const selected = selectedSteps.values().next().value
      if (selected === undefined) throw new OperationPlanError('selected source is missing')
      const previous = plan.steps[index - 1]
      if (previous === undefined || previous.id !== selected || previous.observation.candidates === undefined) {
        throw new OperationPlanError(`plan.steps[${index}].arguments selected references require the preceding step's observation.candidates`)
      }
    }
  }
  for (const [index, assertion] of plan.completion.assertions.entries()) {
    for (const [expressionIndex, expression] of assertionExpressions(assertion).entries()) {
      validateExpression(expression, plan, stepIndexes, plan.steps.length - 1, true, `plan.completion.assertions[${index}][${expressionIndex}]`)
    }
  }
  for (const [index, evidence] of plan.completion.evidence.entries()) {
    validateExpression(evidence, plan, stepIndexes, plan.steps.length - 1, true, `plan.completion.evidence[${index}]`)
  }
}

function validateExpression(
  expression: OperationExpression,
  plan: OperationPlan,
  stepIndexes: ReadonlyMap<string, number>,
  current: number,
  allowCurrentResult: boolean,
  path: string,
): void {
  switch (expression.kind) {
    case 'literal':
      return
    case 'input':
      if (!Object.hasOwn(plan.inputs, expression.input)) throw new OperationPlanError(`${path} references unknown input ${JSON.stringify(expression.input)}`)
      return
    case 'result': {
      const source = stepIndexes.get(expression.step)
      if (source === undefined || source > current || !allowCurrentResult && source === current) {
        throw new OperationPlanError(`${path} references a result that is not available at this point`)
      }
      return
    }
    case 'selected': {
      const source = stepIndexes.get(expression.step)
      if (source === undefined || source !== current - 1) throw new OperationPlanError(`${path} selected reference must name the immediately preceding step`)
      const step = plan.steps[current]
      if (allowCurrentResult && (step === undefined || !selectedSources(step.arguments).has(expression.step))) {
        throw new OperationPlanError(`${path} selected reference requires the current step's arguments to select the same source`)
      }
      return
    }
    case 'object':
      for (const [key, value] of Object.entries(expression.properties)) validateExpression(value, plan, stepIndexes, current, allowCurrentResult, `${path}.${key}`)
      return
    case 'array':
      for (const [index, value] of expression.items.entries()) validateExpression(value, plan, stepIndexes, current, allowCurrentResult, `${path}[${index}]`)
      return
    default:
      return exhaustive(expression)
  }
}

function selectedSources(expression: OperationExpression): Set<string> {
  const sources = new Set<string>()
  const visit = (current: OperationExpression): void => {
    switch (current.kind) {
      case 'selected':
        sources.add(current.step)
        return
      case 'object':
        for (const value of Object.values(current.properties)) visit(value)
        return
      case 'array':
        for (const value of current.items) visit(value)
        return
      case 'literal':
      case 'input':
      case 'result':
        return
      default:
        return exhaustive(current)
    }
  }
  visit(expression)
  return sources
}

function assertionExpressions(assertion: OperationAssertion): readonly OperationExpression[] {
  switch (assertion.kind) {
    case 'present':
    case 'type':
    case 'oneOf':
    case 'number':
    case 'size':
      return [assertion.value]
    case 'equals':
      return [assertion.left, assertion.right]
    default:
      return exhaustive(assertion)
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new OperationPlanError(`${path} must be an object`)
  return value as Record<string, unknown>
}

function objectJson(value: unknown, path: string): Readonly<Record<string, JsonValue>> {
  const parsed = json(value, path)
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new OperationPlanError(`${path} must be a JSON object`)
  return parsed
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new OperationPlanError(`${path} must be an array`)
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new OperationPlanError(`${path} must be a non-empty string`)
  return value
}

function pointer(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new OperationPlanError(`${path} must be a string`)
  try {
    parseJsonPointer(value)
  } catch (error: unknown) {
    if (error instanceof OperationJsonError) throw new OperationPlanError(`${path}: ${error.message}`)
    throw error
  }
  return value
}

function json(value: unknown, path: string): JsonValue {
  try {
    return requireJson(value, path)
  } catch (error: unknown) {
    if (error instanceof OperationJsonError) throw new OperationPlanError(error.message)
    throw error
  }
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new OperationPlanError(`${path} must be a finite number`)
  return value
}

function jsonType(value: unknown, path: string): OperationJsonType {
  if (value === 'null' || value === 'boolean' || value === 'number' || value === 'string' || value === 'array' || value === 'object') return value
  throw new OperationPlanError(`${path} must be a JSON type name`)
}

function exact(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new OperationPlanError(`${path} has unsupported field ${JSON.stringify(key)}`)
  }
}

function exhaustive(value: never): never {
  throw new OperationPlanError(`unsupported plan variant: ${JSON.stringify(value)}`)
}
