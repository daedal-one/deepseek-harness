/**
 * Pure parsing of OpenRouter's public `GET /models` reply body, and the one
 * conversion from its raw price strings to usable numbers. No network, no
 * timers: every export is a synchronous function over `unknown` or over
 * already-parsed entries.
 *
 * @module @deepseek-ai/dsh-openrouter-catalog/parse
 */

import type {
  OpenRouterModelCatalogEntry,
  OpenRouterModelPricing,
  OpenRouterParseResult,
} from './types.ts'

/**
 * Whether a value is a plain object usable as a JSON envelope half.
 * @param value - candidate value.
 * @returns true for objects that are not arrays or null.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
 * Parse one OpenRouter `GET /models` reply body.
 * Elements without a usable string id are skipped — they cannot be addressed
 * by model id — and are not a failure.
 * @param payload - the parsed JSON reply body.
 * @returns the addressable catalog entries, or a detail naming the envelope problem.
 */
export function parseModelsReply(payload: unknown): OpenRouterParseResult<readonly OpenRouterModelCatalogEntry[]> {
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
