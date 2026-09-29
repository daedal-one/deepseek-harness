import { describe, expect, it } from 'vitest'
import { parseOperationPlan } from '../src/plan.ts'
import type { OperationPlan, OperationStep } from '../src/types.ts'
import { evaluateOperationAssertions, resolveOperationExpression } from '../src/resolution.ts'

type MutableStep = { -readonly [Key in keyof OperationStep]: OperationStep[Key] }

function plan(): Omit<OperationPlan, 'steps'> & { steps: MutableStep[] } {
  return {
    version: 1,
    name: 'read-then-act',
    goal: 'carry one selected value forward',
    inputs: { root: { target: 'alpha' } },
    steps: [
      {
        id: 'read',
        purpose: 'read choices',
        tool: 'read_fixture',
        arguments: { kind: 'input', input: 'root', pointer: '' },
        assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/choices' } }],
        observation: { paths: ['/choices'], candidates: '/choices' },
        question: 'Which supplied record supports the next fixed action?',
      },
      {
        id: 'act',
        purpose: 'act on selected choice',
        tool: 'act_fixture',
        arguments: { kind: 'object', properties: { target: { kind: 'selected', step: 'read', pointer: '/target' } } },
        assertions: [{ kind: 'equals', left: { kind: 'result', step: 'act', pointer: '/ok' }, right: { kind: 'literal', value: true } }],
        observation: { paths: ['/ok'] },
        question: 'Does this complete action preserve the goal?',
      },
    ],
    completion: {
      assertions: [{ kind: 'equals', left: { kind: 'result', step: 'act', pointer: '/ok' }, right: { kind: 'literal', value: true } }],
      evidence: [{ kind: 'result', step: 'act', pointer: '/ok' }],
      question: 'Do the declared checks support completion?',
    },
  }
}

describe('operation plan parser', () => {
  it('preserves typed selected values without string interpolation', () => {
    const parsed = parseOperationPlan(plan())
    const expression = parsed.steps[1]!.arguments
    const value = resolveOperationExpression(expression, {
      inputs: parsed.inputs,
      results: new Map([['read', { choices: [{ target: null }] }]]),
      selected: new Map([['read', { target: null }]]),
    })
    expect(value.value).toEqual({ target: null })
    expect(value.provenance).toEqual([{ kind: 'selected', step: 'read', pointer: '/target' }])
  })

  it('rejects forward result references and non-adjacent selected sources', () => {
    const forward = plan()
    forward.steps[0]!.arguments = { kind: 'result', step: 'act', pointer: '' }
    expect(() => parseOperationPlan(forward)).toThrow('not available')

    const nonAdjacent = plan()
    nonAdjacent.steps.splice(1, 0, {
      id: 'middle', purpose: 'middle', tool: 'read_fixture', arguments: { kind: 'literal', value: {} },
      assertions: [{ kind: 'present', value: { kind: 'result', step: 'middle', pointer: '' } }],
      observation: { paths: [''] }, question: 'continue?',
    })
    expect(() => parseOperationPlan(nonAdjacent)).toThrow('immediately preceding')
  })

  it('keeps missing pointers distinct from explicit null in required checks', () => {
    const parsed = parseOperationPlan(plan())
    const assertions = evaluateOperationAssertions(parsed.steps[0]!.assertions, {
      inputs: parsed.inputs,
      results: new Map([['read', { choices: null }]]),
    })
    expect(assertions).toEqual([{ index: 0, passed: true, reason: 'passed' }])

    const missing = evaluateOperationAssertions(parsed.steps[0]!.assertions, {
      inputs: parsed.inputs,
      results: new Map([['read', {}]]),
    })
    expect(missing[0]!.passed).toBe(false)
    expect(missing[0]!.reason).toContain('missing JSON Pointer')
  })
})
