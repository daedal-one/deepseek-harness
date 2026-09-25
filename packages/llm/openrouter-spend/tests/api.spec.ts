import { describe, expect, it } from 'vitest'
import { findModelPricing, parseKeyReply, parseModelsReply } from '../src/api.ts'

function keyReply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

describe('parseModelsReply', () => {
  it('parses a valid models reply with raw string price slots', () => {
    const parsed = parseModelsReply({
      data: [
        {
          id: 'anthropic/claude-3',
          name: 'Claude 3',
          pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' },
        },
        { id: 'passthrough-model', name: 'No fixed price', pricing: { prompt: '-1', completion: '-1' } },
        { id: 'bare-model' },
      ],
    })
    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          id: 'anthropic/claude-3',
          pricing: { prompt: '0.000003', completion: '0.000015', cacheRead: '0.0000003', cacheWrite: '0.00000375' },
        },
        { id: 'passthrough-model', pricing: { prompt: '-1', completion: '-1', cacheRead: null, cacheWrite: null } },
        { id: 'bare-model', pricing: { prompt: null, completion: null, cacheRead: null, cacheWrite: null } },
      ],
    })
  })

  it('skips elements without a usable string id without failing', () => {
    const parsed = parseModelsReply({
      data: [
        { name: 'anonymous' },
        { id: '' },
        { id: 3 },
        'junk',
        42,
        { id: 'real-model', pricing: { prompt: '0', completion: '0' } },
      ],
    })
    expect(parsed).toEqual({
      ok: true,
      value: [{ id: 'real-model', pricing: { prompt: '0', completion: '0', cacheRead: null, cacheWrite: null } }],
    })
  })

  it('rejects an unusable envelope', () => {
    expect(parseModelsReply(null)).toMatchObject({ ok: false })
    expect(parseModelsReply({})).toMatchObject({ ok: false, detail: '"data" must be an array' })
    expect(parseModelsReply({ data: 'nope' })).toMatchObject({ ok: false, detail: '"data" must be an array' })
    expect(parseModelsReply({ data: [{ id: 'm', pricing: 'cheap' }] }))
      .toMatchObject({ ok: false, detail: '"data[0].pricing" must be an object' })
  })
})

describe('findModelPricing', () => {
  const models = [
    { id: 'a/b', pricing: { prompt: '1', completion: '2', cacheRead: null, cacheWrite: null } },
    { id: 'c/d', pricing: { prompt: null, completion: null, cacheRead: null, cacheWrite: null } },
  ]

  it('hits on an exact model id', () => {
    expect(findModelPricing(models, 'a/b')).toEqual({ prompt: '1', completion: '2', cacheRead: null, cacheWrite: null })
  })

  it('misses on a non-exact model id', () => {
    expect(findModelPricing(models, 'a/b-other')).toBeUndefined()
    expect(findModelPricing([], 'a/b')).toBeUndefined()
  })
})
