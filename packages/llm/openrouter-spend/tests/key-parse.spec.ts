import { describe, expect, it } from 'vitest'
import { parseKeyReply } from '../src/key-parse.ts'

function keyReply(overrides: Record<string, unknown> = {}): { data: Record<string, unknown> } {
  return {
    data: {
      label: 'test key',
      usage: 12.5,
      usage_daily: 1.5,
      usage_weekly: 5.5,
      usage_monthly: 12.5,
      limit: 100,
      limit_remaining: 87.5,
      is_free_tier: false,
      ...overrides,
    },
  }
}

describe('parseKeyReply', () => {
  it('parses a valid key reply', () => {
    const parsed = parseKeyReply(keyReply())
    expect(parsed).toEqual({
      ok: true,
      value: {
        label: 'test key',
        usageUsd: 12.5,
        usageDailyUsd: 1.5,
        usageWeeklyUsd: 5.5,
        usageMonthlyUsd: 12.5,
        limitUsd: 100,
        limitRemainingUsd: 87.5,
        isFreeTier: false,
      },
    })
  })

  it('accepts limit: null and an absent limit alike', () => {
    const nullLimit = parseKeyReply(keyReply({ limit: null, limit_remaining: null }))
    expect(nullLimit).toEqual({
      ok: true,
      value: {
        label: 'test key',
        usageUsd: 12.5,
        usageDailyUsd: 1.5,
        usageWeeklyUsd: 5.5,
        usageMonthlyUsd: 12.5,
        limitUsd: null,
        limitRemainingUsd: null,
        isFreeTier: false,
      },
    })
    const stripped = keyReply()
    delete stripped.data.limit
    delete stripped.data.limit_remaining
    expect(parseKeyReply(stripped)).toEqual(nullLimit)
  })

  it('rejects an unusable envelope, naming the offending field', () => {
    expect(parseKeyReply('nope')).toMatchObject({ ok: false })
    expect(parseKeyReply({})).toMatchObject({ ok: false, detail: '"data" must be an object' })
    expect(parseKeyReply({ data: 'x' })).toMatchObject({ ok: false, detail: '"data" must be an object' })
    expect(parseKeyReply({ data: null })).toMatchObject({ ok: false, detail: '"data" must be an object' })
  })

  it('rejects each malformed field with a field-naming detail', () => {
    const cases: [string, unknown, string][] = [
      ['label', 42, '"data.label" must be a string'],
      ['usage', -1, '"data.usage" must be a finite non-negative number'],
      ['usage', Infinity, '"data.usage" must be a finite non-negative number'],
      ['usage_daily', NaN, '"data.usage_daily" must be a finite non-negative number'],
      ['usage_weekly', '1', '"data.usage_weekly" must be a finite non-negative number'],
      ['usage_monthly', true, '"data.usage_monthly" must be a finite non-negative number'],
      ['is_free_tier', 'no', '"data.is_free_tier" must be a boolean'],
    ]
    for (const [field, value, detail] of cases) {
      const parsed = parseKeyReply(keyReply({ [field]: value }))
      expect(parsed, field).toEqual({ ok: false, detail })
    }
  })

  it('rejects an incoherent unlimited key response', () => {
    expect(parseKeyReply(keyReply({ limit: null, limit_remaining: 1 }))).toEqual({
      ok: false,
      detail: '"data.limit" and "data.limit_remaining" must both be null when the key is unlimited',
    })
    expect(parseKeyReply(keyReply({ limit: 1, limit_remaining: null }))).toEqual({
      ok: false,
      detail: '"data.limit" and "data.limit_remaining" must both be null when the key is unlimited',
    })
  })

  it('rejects a malformed limit field with a field-naming detail', () => {
    for (const value of [-1, Infinity, '100', {}]) {
      const parsed = parseKeyReply(keyReply({ limit: value }))
      expect((parsed as { ok: false; detail: string }).detail).toContain('data.limit"')
    }
    for (const value of [-0.5, 'left']) {
      const parsed = parseKeyReply(keyReply({ limit_remaining: value }))
      expect((parsed as { ok: false; detail: string }).detail).toContain('data.limit_remaining"')
    }
  })

  it('never returns a partially-built value', () => {
    const parsed = parseKeyReply(keyReply({ label: 7 }))
    expect('value' in parsed).toBe(false)
  })
})

