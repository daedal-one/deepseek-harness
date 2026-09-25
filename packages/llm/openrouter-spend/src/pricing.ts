/**
 * Pure USD math over OpenRouter's per-token prices. No network, no timers.
 * @module @deepseek-ai/dsh-openrouter-spend/pricing
 */

import type { OpenRouterModelPricing } from './api.ts'

/** Token counts that one session cost estimate prices. */
export interface OpenRouterTokenBuckets {
  /** Prompt tokens not served from the prompt cache. */
  readonly uncachedInputTokens: number
  /** Generated completion tokens. */
  readonly outputTokens: number
  /** Prompt tokens served from the prompt cache. */
  readonly cacheReadTokens: number
  /** Prompt tokens written to the prompt cache. */
  readonly cacheWriteTokens: number
}

/**
 * Parse one OpenRouter catalog price string into a usable per-token USD value.
 * A value of `-1` is OpenRouter's pass-through marker: any negative,
 * non-finite, or non-numeric price is unpriceable, never a real number.
 * @param raw - the raw catalog price string, or null when the slot is absent.
 * @returns the finite non-negative per-token USD value, or null when unpriceable.
 */
export function usdPerToken(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Whether a token bucket is a usable count.
 * @param value - bucket value.
 * @returns true for finite non-negative counts.
 */
function isUsableBucket(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * Price one session's token buckets at one model's catalog prices.
 * The estimate is the exact sum with no rounding; it is null as soon as the
 * cost cannot be computed honestly — a zero bucket never requires its price.
 * @param buckets - the session's token counts.
 * @param pricing - the model's raw catalog prices.
 * @returns the exact USD cost, or null when the cost is unpriceable.
 */
export function sessionCostUsd(buckets: OpenRouterTokenBuckets, pricing: OpenRouterModelPricing): number | null {
  const { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = buckets
  if (!isUsableBucket(uncachedInputTokens)
    || !isUsableBucket(outputTokens)
    || !isUsableBucket(cacheReadTokens)
    || !isUsableBucket(cacheWriteTokens)) {
    return null
  }
  const prompt = usdPerToken(pricing.prompt)
  const completion = usdPerToken(pricing.completion)
  if (prompt === null || completion === null) return null
  let cost = uncachedInputTokens * prompt + outputTokens * completion
  if (cacheReadTokens > 0) {
    const cacheRead = usdPerToken(pricing.cacheRead)
    if (cacheRead === null) return null
    cost += cacheReadTokens * cacheRead
  }
  if (cacheWriteTokens > 0) {
    const cacheWrite = usdPerToken(pricing.cacheWrite)
    if (cacheWrite === null) return null
    cost += cacheWriteTokens * cacheWrite
  }
  return cost
}
