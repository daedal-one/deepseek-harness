/**
 * Public vocabulary for the shared OpenRouter catalog read.
 *
 * @module @deepseek-ai/dsh-openrouter-catalog/types
 */

/** Why one OpenRouter read could not complete. */
export type OpenRouterFailureReason =
  | 'not-configured' | 'unauthorized' | 'rate-limited' | 'unreachable' | 'malformed-response'

/** One failed OpenRouter read; `detail` never carries the credential or any part of it. */
export interface OpenRouterFailure {
  /** Stable machine-readable failure class. */
  readonly reason: OpenRouterFailureReason
  /** Human-readable explanation that names no secret. */
  readonly detail: string
}

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

/** Options for one OpenRouter read operation. */
export interface OpenRouterReadOptions {
  /** OpenRouter endpoint base; `/key` and `/models` are appended. */
  readonly baseURL: string
  /** The configured OpenRouter inference key; sent only in the Authorization header. */
  readonly apiKey: string
  /** Upper bound on one OpenRouter request, in milliseconds. */
  readonly requestTimeoutMs: number
}

/** Successful or failed outcome of one pure reply parse. */
export type OpenRouterParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly detail: string }

/** Successful or failed outcome of one OpenRouter network read. */
export type OpenRouterReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OpenRouterFailure }
