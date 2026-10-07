/**
 * Pure parsing of OpenRouter's `GET /key` reply body. No network, no timers:
 * every export is a synchronous function over `unknown`.
 *
 * The public `GET /models` reply, its price conversion, and the network
 * boundary live in `@deepseek-ai/dsh-openrouter-catalog`, which this package
 * shares with model routing.
 *
 * @module @deepseek-ai/dsh-openrouter-spend/key-parse
 */

import type { OpenRouterParseResult } from '@deepseek-ai/dsh-openrouter-catalog'
import type { OpenRouterKeyUsage } from './types.ts'

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
 * Parse one OpenRouter `GET /key` reply body.
 * @param payload - the parsed JSON reply body.
 * @returns the key usage, or a detail naming the exact offending field.
 */
export function parseKeyReply(payload: unknown): OpenRouterParseResult<OpenRouterKeyUsage> {
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
  if ((limit === null) !== (limitRemaining === null)) {
    return { ok: false, detail: '"data.limit" and "data.limit_remaining" must both be null when the key is unlimited' }
  }
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
