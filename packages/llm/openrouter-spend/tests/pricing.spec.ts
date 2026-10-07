import { describe, expect, it } from 'vitest'
import type { OpenRouterModelPricing } from '@deepseek-ai/dsh-openrouter-catalog'
import { sessionCostUsd } from '../src/pricing.ts'

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
    const bad = [
      ['uncachedInputTokens', -1],
      ['outputTokens', NaN],
      ['cacheReadTokens', Infinity],
      ['cacheWriteTokens', -0.5],
    ] as const
    for (const [field, value] of bad) {
      const buckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      buckets[field] = value
      expect(sessionCostUsd(buckets, pricing()), field).toBeNull()
    }
  })
})
