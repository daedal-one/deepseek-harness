/**
 * Pure parsing of OpenRouter `GET /key` and `GET /models` reply bodies.
 * No network, no timers: every export is a synchronous function over `unknown`.
 * @module @deepseek-ai/dsh-openrouter-spend/api
 */

import type { OpenRouterKeyUsage } from './types.ts'

/**
 * Raw per-token prices for one catalog model, in USD per token as JSON
 * strings; a null slot is absent from the reply or not a JSON string.
 */
export interface OpenRouterModelPricing {
  /** Raw `pricing.prompt` string, or null when absent or not a JSON string. */
  readonly prompt: string | null
  /** Raw `pricing.completion` string, or null when absent or not a JSON string. */
  readonly completion: string | null
  /** Raw `pricing.input_cache_read` string, or null when absent or not a JSON string. */
  readonly cacheRead: string | null
  /** Raw `pricing.input_cache_write` string, or null when absent or not a JSON string. */
  readonly cacheWrite: string | null
}

/** One catalog model: its exact id and raw per-token prices. */
export interface OpenRouterModelCatalogEntry {
  /** Exact OpenRouter model id. */
  readonly id: string
  /** Raw per-token prices for the model. */
  readonly pricing: OpenRouterModelPricing
}

/** Parse result of one OpenRouter `GET /key` reply body. */
export type OpenRouterKeyParseResult =
  | { readonly ok: true; readonly value: OpenRouterKeyUsage }
  | { readonly ok: false; readonly detail: string }

/** Parse result of one OpenRouter `GET /models` reply body. */
export type OpenRouterModelsParseResult =
  | { readonly ok: true; readonly value: readonly OpenRouterModelCatalogEntry[] }
  | { readonly ok: false; readonly detail: string }

/**
 * Whether a value is a plain object usable as a JSON envelope half.
 * @param value - candidate value.
 * @returns true for objects that are not arrays or null.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value is a finite non-negative number.
 * @param value - candidate value.
 * @returns true for usable money fields.
 */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Read a limit field that accepts a finite non-negative number, null, or absence.
 * @param record - envelope half carrying the field.
 * @param field - JSON name of the field, named in failures.
 * @returns the value or null for absence/null, or undefined when malformed.
 */
function readLimit(record: Record<string, unknown>, field: string): number | null | undefined {
  const raw = record[field]
  if (raw === undefined || raw === null) return null
  return isNonNegativeNumber(raw) ? raw : undefined
}

/**
 * Read a price slot that accepts a JSON string or absence.
 * @param pricing - the model's `pricing` object.
 * @param field - JSON name of the slot.
 * @returns the raw string, or null when the slot is absent or not a string.
 */
function readPriceSlot(pricing: Record<string, unknown>, field: string): string | null {
  const raw = pricing[field]
  return typeof raw === 'string' ? raw : null
}

/**
 * Parse one OpenRouter `GET /key` reply body.
 * @param payload - the parsed JSON reply body.
 * @returns the key usage, or a detail naming the exact offending field.
 */
export function parseKeyReply(payload: unknown): OpenRouterKeyParseResult {
  if (!isRecord(payload)) return { ok: false, detail: 'reply must be an object with a "data" object' }
  if (!isRecord(payload.data)) return { ok: false, detail: '"data" must be an object' }
  const data = payload.data
  if (typeof data.label !== 'string') return { ok: false, detail: '"data.label" must be a string' }
  if (!isNonNegativeNumber(data.usage)) return { ok: false, detail: '"data.usage" must be a finite non-negative number' }
  if (!isNonNegativeNumber(data.usage_daily)) return { ok: false, detail: '"data.usage_daily" must be a finite non-negative number' }
  if (!isNonNegativeNumber(data.usage_weekly)) return { ok: false, detail: '"data.usage_weekly" must be a finite non-negative number' }
  if (!isNonNegativeNumber(data.usage_monthly)) return { ok: false, detail: '"data.usage_monthly" must be a finite non-negative number' }
  const limit = readLimit(data, 'limit')
  if (limit === undefined) return { ok: false, detail: '"data.limit" must be a finite non-negative number or null' }
  const limitRemaining = readLimit(data, 'limit_remaining')
  if (limitRemaining === undefined) return { ok: false, detail: '"data.limit_remaining" must be a finite non-negative number or null' }
  if (typeof data.is_free_tier !== 'boolean') return { ok: false, detail: '"data.is_free_tier" must be a boolean' }
  return {
    ok: true,
    value: {
      label: data.label,
      usageUsd: data.usage,
      usageDailyUsd: data.usage_daily,
      usageWeeklyUsd: data.usage_weekly,
      usageMonthlyUsd: data.usage_monthly,
      limitUsd: limit,
      limitRemainingUsd: limitRemaining,
      isFreeTier: data.is_free_tier,
    },
  }
}

/**
 * Parse one OpenRouter `GET /models` reply body.
 * Elements without a usable string id are skipped — they cannot be addressed
 * by model id — and are not a failure.
 * @param payload - the parsed JSON reply body.
 * @returns the addressable catalog entries, or a detail naming the envelope problem.
 */
export function parseModelsReply(payload: unknown): OpenRouterModelsParseResult {
  if (!isRecord(payload)) return { ok: false, detail: 'reply must be an object with a "data" array' }
  if (!Array.isArray(payload.data)) return { ok: false, detail: '"data" must be an array' }
  const entries: OpenRouterModelCatalogEntry[] = []
  for (let index = 0; index < payload.data.length; index++) {
    const element: unknown = payload.data[index]
    if (!isRecord(element) || typeof element.id !== 'string' || element.id.length === 0) continue
    const pricing = element.pricing
    if (pricing !== undefined && !isRecord(pricing)) {
      return { ok: false, detail: `"data[${index}].pricing" must be an object` }
    }
    entries.push({
      id: element.id,
      pricing: pricing === undefined
        ? { prompt: null, completion: null, cacheRead: null, cacheWrite: null }
        : {
          prompt: readPriceSlot(pricing, 'prompt'),
          completion: readPriceSlot(pricing, 'completion'),
          cacheRead: readPriceSlot(pricing, 'input_cache_read'),
          cacheWrite: readPriceSlot(pricing, 'input_cache_write'),
        },
    })
  }
  return { ok: true, value: entries }
}

/**
 * Look up one model's pricing by exact id.
 * @param models - parsed catalog entries.
 * @param modelId - exact OpenRouter model id to match.
 * @returns the entry's pricing, or undefined when no entry has that id.
 */
export function findModelPricing(
  models: readonly OpenRouterModelCatalogEntry[],
  modelId: string,
): OpenRouterModelPricing | undefined {
  return models.find(model => model.id === modelId)?.pricing
}
