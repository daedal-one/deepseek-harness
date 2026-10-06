/** Concise requests resolve into explicit immutable runner programs. */
import { describe, expect, it } from 'vitest'
import { validateArgs } from '@deepseek-ai/dsh-tools'
import { operationPlanParameters } from '../src/plan-schema.ts'
import { parseOperationPlan, resolveOperationPlan } from '../src/plan.ts'

const simple = {
  goal: 'Read repository status',
  steps: [{ tool: 'bash', arguments: { command: 'git status --short' } }],
}

describe('concise operation requests', () => {
  it('accepts ordinary arguments and supplies immutable bookkeeping and complete evidence', () => {
    expect(validateArgs(operationPlanParameters, { plan: simple })).toEqual([])
    const resolved = resolveOperationPlan(simple)
    expect(resolved).toMatchObject({
      version: 1, name: simple.goal, goal: simple.goal, inputs: {},
      steps: [{ id: 'step-1', tool: 'bash', arguments: { kind: 'literal', value: simple.steps[0]!.arguments },
        assertions: [{ kind: 'present', value: { kind: 'result', step: 'step-1', pointer: '' } }],
        observation: { paths: [''] } }],
      completion: { evidence: [{ kind: 'result', step: 'step-1', pointer: '' }] },
    })
    expect(Object.isFrozen(resolved.steps[0]!.arguments)).toBe(true)
    expect(parseOperationPlan(resolved)).toEqual(resolved)
    expect(() => parseOperationPlan(simple)).toThrow('plan.version must equal 1')
    expect(simple).toEqual({ goal: 'Read repository status', steps: [{ tool: 'bash', arguments: { command: 'git status --short' } }] })
  })
  it('preserves explicit complete observations, every step, and tightening limits', () => {
    const resolved = resolveOperationPlan({ ...simple, requestedLimits: { maxSteps: 2 }, steps: [
      { ...simple.steps[0], observe: ['/stdout/text'] },
      { tool: 'read', arguments: { file_path: 'README.md' }, observe: ['/lines', '/totalLines'] },
    ] })
    expect(resolved.steps.map(step => step.id)).toEqual(['step-1', 'step-2'])
    expect(resolved.completion.assertions).toHaveLength(2)
    expect(resolved.completion.evidence).toEqual([
      { kind: 'result', step: 'step-1', pointer: '/stdout/text' },
      { kind: 'result', step: 'step-2', pointer: '/lines' },
      { kind: 'result', step: 'step-2', pointer: '/totalLines' },
    ])
    expect(resolved.requestedLimits).toEqual({ maxSteps: 2 })
    expect(resolveOperationPlan(resolved)).toEqual(resolved)
  })
  it.each([
    { ...simple, goal: '' }, { ...simple, steps: [] },
    { ...simple, steps: [{ tool: '', arguments: {} }] },
    { ...simple, steps: [{ tool: 'bash', arguments: null }] },
    { ...simple, steps: [{ tool: 'bash', arguments: [] }] },
    { ...simple, steps: [{ tool: 'bash', arguments: {}, observe: [] }] },
    { ...simple, steps: [{ tool: 'bash', arguments: {}, observe: ['/a', '/a'] }] },
    { ...simple, steps: [{ tool: 'bash', arguments: {}, observe: ['invalid'] }] },
    { ...simple, steps: [{ tool: 'bash', arguments: {}, purpose: 'unrecognized' }] },
    { ...simple, completion: {} }, { ...simple, unexpected: true },
    { ...simple, requestedLimits: { maxSteps: 0 } },
    { ...simple, requestedLimits: { unknown: 1 } },
  ])('rejects invalid or mixed requests %j', (request) => {
    expect(() => resolveOperationPlan(request)).toThrow()
  })
})
