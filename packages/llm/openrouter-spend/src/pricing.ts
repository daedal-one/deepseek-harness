/**
 * Pure USD math and durable route attribution for OpenRouter session estimates.
 * @module @deepseek-ai/dsh-openrouter-spend/pricing
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { OpenRouterModelPricing } from './api.ts'

/** Token counts that one settled request cost estimate prices. */
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

/** Durable route and provider usage for one settled model attempt. */
export interface AttributedSessionUsage {
  /** Provider that received the request. */
  readonly provider: string
  /** Exact model that received the request. */
  readonly model: string
  /** Provider-reported buckets for this one settled attempt. */
  readonly buckets: OpenRouterTokenBuckets
}

/**
 * Parse one OpenRouter catalog price string into a usable per-token USD value.
 * A value of `-1` is OpenRouter's pass-through marker: any blank, negative,
 * non-finite, or non-numeric price is unpriceable, never a real number.
 * @param raw - the raw catalog price string, or null when the slot is absent.
 * @returns the finite non-negative per-token USD value, or null when unpriceable.
 */
export function usdPerToken(raw: string | null): number | null {
  if (raw === null || raw.trim().length === 0) return null
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
 * Read the newest usage sample carried by one durable assistant stream.
 * @param stream - complete compact stream for one settled attempt.
 * @returns the last usage sample, when the provider reported one.
 */
function usageFromStream(
  stream: SessionEvent<'assistant/attempt'>['data']['stream'],
): { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number } | undefined {
  for (let index = stream.length - 1; index >= 0; index--) {
    const record = stream[index]
    if (record?.type === 'chunk' && record.chunk.type === 'usage') return record.chunk.usage
  }
  return undefined
}

/**
 * Convert one provider usage sample to the four price buckets.
 * @param usage - durable provider usage.
 * @returns the corresponding cost buckets.
 */
function bucketsFrom(
  usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number },
): OpenRouterTokenBuckets {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/**
 * Return a non-empty provider/model route.
 * @param route - candidate durable request route.
 * @returns the route, or undefined when it cannot attribute usage safely.
 */
function validRoute(route: { readonly provider: string; readonly model: string }): { readonly provider: string; readonly model: string } | undefined {
  return route.provider.trim().length > 0 && route.model.trim().length > 0 ? route : undefined
}

/**
 * Derive every settled provider usage from the session log with the exact route
 * that produced it. Successful assistant messages carry their own durable
 * source. Failed or interrupted attempts have no message source, so they use
 * the latest durable request header; no header leaves their usage unpriceable.
 * @param events - full ordered durable session log.
 * @returns attributed usage, or null when any settled usage lacks a route.
 */
export function attributedSessionUsage(events: readonly SessionEvent[]): readonly AttributedSessionUsage[] | null {
  let requestRoute: { readonly provider: string; readonly model: string } | undefined
  const usages: AttributedSessionUsage[] = []

  for (const event of events) {
    if (event.type === 'request/header') {
      requestRoute = validRoute(event.data.header.config)
      continue
    }

    if (event.type === 'assistant/message') {
      const usage = event.data.usage ?? usageFromStream(event.data.stream)
      if (usage === undefined) continue
      const route = validRoute(event.data.message.source)
      if (route === undefined) return null
      usages.push({ ...route, buckets: bucketsFrom(usage) })
      continue
    }

    if (event.type === 'assistant/attempt') {
      const usage = usageFromStream(event.data.stream)
      if (usage === undefined) continue
      if (requestRoute === undefined) return null
      usages.push({ ...requestRoute, buckets: bucketsFrom(usage) })
    }
  }

  return usages
}

/**
 * Price one settled request's token buckets at one model's catalog prices.
 * The estimate is the exact sum with no rounding; it is null as soon as the
 * cost cannot be computed honestly — a zero bucket never requires its price.
 * @param buckets - the settled request's token counts.
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
  return Number.isFinite(cost) ? cost : null
}
