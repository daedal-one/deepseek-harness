import { describe, expect, it } from 'vitest'
import type { OpenRouterModelPricing } from '../src/api.ts'
import { sessionCostUsd, usdPerToken } from '../src/pricing.ts'

describe('usdPerToken', () => {
  it('prices a normal per-token string', () => {
    expect(usdPerToken('0.000001')).toBe(0.000001)
  })

  it('prices zero as a legitimate price', () => {
    expect(usdPerToken('0')).toBe(0)
  })

  it('treats the -1 pass-through marker as unpriceable', () => {
    expect(usdPerToken('-1')).toBeNull()
  })

  it('treats any negative value as unpriceable', () => {
    expect(usdPerToken('-0.5')).toBeNull()
  })

  it('treats a non-numeric string as unpriceable', () => {
    expect(usdPerToken('abc')).toBeNull()
  })

  it('treats blank and whitespace-only prices as unpriceable rather than zero', () => {
    expect(usdPerToken('')).toBeNull()
    expect(usdPerToken('   ')).toBeNull()
    expect(usdPerToken('\t\n')).toBeNull()
  })

  it('treats an absent slot as unpriceable', () => {
    expect(usdPerToken(null)).toBeNull()
  })

  it('treats non-finite values as unpriceable', () => {
    expect(usdPerToken('Infinity')).toBeNull()
    expect(usdPerToken('-Infinity')).toBeNull()
    expect(usdPerToken('NaN')).toBeNull()
  })
})

function pricing(overrides: Partial<OpenRouterModelPricing> = {}): OpenRouterModelPricing {
  return {
    prompt: '0.000001',
    completion: '0.000002',
    cacheRead: '0.0000002',
    cacheWrite: '0.00000125',
    ...overrides,
  }
}

describe('sessionCostUsd', () => {
  it('prices a fully priced session exactly', () => {
    const cost = sessionCostUsd(
      { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 50 },
      pricing(),
    )
    expect(cost).toBe(1000 * 0.000001 + 500 * 0.000002 + 200 * 0.0000002 + 50 * 0.00000125)
    expect(cost).toBeCloseTo(0.0021025, 12)
  })

  it('is null when completion is unpriceable', () => {
    expect(
      sessionCostUsd(
        { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        pricing({ completion: null }),
      ),
    ).toBeNull()
    expect(
      sessionCostUsd(
        { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        pricing({ completion: '-1' }),
      ),
    ).toBeNull()
  })

  it('prices a session with zero cache buckets even when cache prices are missing', () => {
    const cost = sessionCostUsd(
      { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      pricing({ cacheRead: null, cacheWrite: null }),
    )
    expect(cost).toBe(1000 * 0.000001 + 500 * 0.000002)
  })

  it('is null when a non-zero cache bucket lacks its price', () => {
    expect(
      sessionCostUsd(
        { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 0 },
        pricing({ cacheRead: null }),
      ),
    ).toBeNull()
    expect(
      sessionCostUsd(
        { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 50 },
        pricing({ cacheWrite: '-1' }),
      ),
    ).toBeNull()
  })

  it('is null when a bucket is not a finite non-negative number', () => {
    const bad: [string, number][] = [
      ['uncachedInputTokens', -1],
      ['outputTokens', NaN],
      ['cacheReadTokens', Infinity],
      ['cacheWriteTokens', -0.5],
    ]
    for (const [field, value] of bad) {
      const buckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      buckets[field] = value
      expect(sessionCostUsd(buckets, pricing()), field).toBeNull()
    }
  })
})
