import { describe, expect, it } from 'vitest'
import { validateArgs } from '@deepseek-ai/dsh-tools'
import { operationPlanParameters } from '../src/plan-schema.ts'
import { parseOperationPlan } from '../src/plan.ts'
import { DEFAULT_OPERATION_LIMITS } from '../src/runner.ts'
import type { OperationAssertion, OperationExpression, OperationPlan } from '../src/types.ts'

const result = { kind: 'result', step: 'act', pointer: '/ok' } as const
const present = { kind: 'present', value: result } as const
function plan(expression: OperationExpression = { kind: 'literal', value: {} }, assertion: OperationAssertion = present): OperationPlan {
  return { version: 1, name: 'schema-fixture', goal: 'Inspect supplied structured evidence', inputs: { root: {} }, steps: [
    { id: 'read', tool: 'read_fixture', purpose: 'Read candidates', arguments: { kind: 'literal', value: {} },
      assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/choices' } }],
      observation: { paths: ['/choices'], candidates: '/choices' }, question: 'Which record supports the next action?' },
    { id: 'act', tool: 'act_fixture', purpose: 'Inspect selected value', arguments: expression, assertions: [assertion],
      observation: { paths: ['/ok'] }, question: 'Is the result available?' },
  ], completion: { assertions: [assertion], evidence: [result], question: 'Is the requested evidence available?' },
  requestedLimits: DEFAULT_OPERATION_LIMITS }
}

describe('model-facing operation plan schema', () => {
  it.each<OperationExpression>([
    { kind: 'literal', value: { enabled: true } }, { kind: 'input', input: 'root', pointer: '' },
    { kind: 'result', step: 'read', pointer: '/choices' }, { kind: 'selected', step: 'read', pointer: '/id' },
    { kind: 'object', properties: { nested: { kind: 'array', items: [{ kind: 'literal', value: null }] } } },
    { kind: 'array', items: [{ kind: 'object', properties: { flag: { kind: 'literal', value: true } } }] },
  ])('accepts the parser-supported $kind expression', (expression) => {
    const value = plan(expression)
    expect(validateArgs(operationPlanParameters, { plan: value })).toEqual([])
    expect(parseOperationPlan(value)).toEqual(value)
  })
  it.each<OperationAssertion>([
    present, { kind: 'type', value: result, type: 'boolean' },
    { kind: 'equals', left: result, right: { kind: 'literal', value: true } },
    { kind: 'oneOf', value: result, values: [true, null] },
    { kind: 'number', value: result, min: 0 }, { kind: 'size', value: result, max: 2 },
  ])('accepts the parser-supported $kind assertion and tightening-limit fields', (assertion) => {
    const value = plan(undefined, assertion)
    expect(validateArgs(operationPlanParameters, { plan: value })).toEqual([])
    expect(parseOperationPlan(value)).toEqual(value)
  })
  it('leaves recursive validation to the parser without limiting valid nesting', () => {
    let nested: OperationExpression = { kind: 'literal', value: 'leaf' }
    for (let index = 0; index < 24; index++) nested = { kind: 'array', items: [nested] }
    expect(validateArgs(operationPlanParameters, { plan: plan(nested) })).toEqual([])
    expect(parseOperationPlan(plan(nested)).steps[1]!.arguments).toEqual(nested)
    const malformed = plan({ kind: 'object', properties: {} })
    const raw = { ...malformed, steps: [malformed.steps[0], { ...malformed.steps[1], arguments: {
      kind: 'object', properties: { bad: { kind: 'unsupported' } },
    } }] }
    expect(validateArgs(operationPlanParameters, { plan: raw })).toEqual([])
    expect(() => parseOperationPlan(raw)).toThrow('unsupported')
  })
  it.each([
    { ...plan(), version: 2 }, { ...plan(), version: undefined }, { ...plan(), unexpected: true },
  ])('rejects invalid field structure before parsing %j', (value) => {
    expect(validateArgs(operationPlanParameters, { plan: value }).length).toBeGreaterThan(0)
  })
  it.each([
    { ...plan(), steps: [] }, { ...plan(), requestedLimits: { maxSteps: 0 } },
    { ...plan(), completion: { ...plan().completion, assertions: [{ kind: 'number', value: result }] } },
    { ...plan(), steps: [{ ...plan().steps[0], arguments: {} }] },
    { ...plan(), steps: [{ ...plan().steps[0], observation: { paths: [0] } }] },
    { ...plan(), completion: { ...plan().completion, assertions: [{ kind: 'equals', left: {}, right: {} }] } },
    { ...plan(), requestedLimits: { maxSteps: 1.5 } },
  ])('retains parser-owned detailed syntax, nonempty and numeric constraints', (value) => {
    expect(validateArgs(operationPlanParameters, { plan: value })).toEqual([])
    expect(() => parseOperationPlan(value)).toThrow()
  })
})
