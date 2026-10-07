import { describe, expect, it } from 'vitest'
import { assertTaskClasses } from '../src/spec.ts'
import type { TaskClassSpec } from '../src/types.ts'

function spec(overrides: Partial<TaskClassSpec> = {}): TaskClassSpec {
  return {
    requirements: {},
    tiers: [{ name: 'preferred', modelPatterns: ['vendor/*'] }],
    costBasis: { inputTokens: 1000, outputTokens: 100 },
    ...overrides,
  }
}

describe('assertTaskClasses', () => {
  it('accepts a well-formed table and keys it by validated id', () => {
    const validated = assertTaskClasses({ standard: spec(), 'hard-reasoning': spec() })

    expect(Object.keys(validated).sort()).toEqual(['hard-reasoning', 'standard'])
  })

  it('accepts a class whose cost basis prices only completion tokens', () => {
    const validated = assertTaskClasses({
      standard: spec({ costBasis: { inputTokens: 0, outputTokens: 100 } }),
    })

    expect(Object.keys(validated)).toEqual(['standard'])
  })

  it('rejects an id that is not lowercase kebab-case', () => {
    expect(() => assertTaskClasses({ Standard: spec() })).toThrow(TypeError)
    expect(() => assertTaskClasses({ 'standard_class': spec() })).toThrow(
      'task class id "standard_class" must be lowercase kebab-case',
    )
  })

  it('rejects a class declaring no preference tier', () => {
    expect(() => assertTaskClasses({ standard: spec({ tiers: [] }) })).toThrow(
      'task class "standard" must declare at least one preference tier',
    )
  })

  it('rejects duplicate tier names', () => {
    expect(() => assertTaskClasses({
      standard: spec({
        tiers: [
          { name: 'trusted', modelPatterns: ['a/*'] },
          { name: 'trusted', modelPatterns: ['b/*'] },
        ],
      }),
    })).toThrow('task class "standard" declares duplicate preference tier "trusted"')
  })

  it('rejects a tier declaring no model pattern', () => {
    expect(() => assertTaskClasses({
      standard: spec({ tiers: [{ name: 'trusted', modelPatterns: [] }] }),
    })).toThrow('task class "standard" tier "trusted" must declare at least one model pattern')
  })

  it('rejects a cost basis that prices no token', () => {
    expect(() => assertTaskClasses({
      standard: spec({ costBasis: { inputTokens: 0, outputTokens: 0 } }),
    })).toThrow('task class "standard" cost basis must price at least one token')
  })
})
