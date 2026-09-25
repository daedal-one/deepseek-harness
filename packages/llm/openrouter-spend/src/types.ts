import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** OpenRouter key usage as reported by `GET {baseURL}/key`; every money field is USD. */
export interface OpenRouterKeyUsage {
  /** Human-readable key label reported by OpenRouter. */
  readonly label: string
  /** Total key spend so far, in USD. */
  readonly usageUsd: number
  /** Key spend on the current UTC day, in USD. */
  readonly usageDailyUsd: number
  /** Key spend on the current UTC week, in USD. */
  readonly usageWeeklyUsd: number
  /** Key spend on the current UTC month, in USD. */
  readonly usageMonthlyUsd: number
  /** Configured spend limit in USD, or null when the key has none. */
  readonly limitUsd: number | null
  /** Remaining spend headroom under the limit in USD, or null when the key is unlimited. */
  readonly limitRemainingUsd: number | null
  /** Whether the key is on OpenRouter's free tier. */
  readonly isFreeTier: boolean
}

/** Session-level cost estimate with the latest durable selection for display. */
export interface OpenRouterSessionSpend {
  /** Provider id of the session's latest durable model selection. */
  readonly provider: string
  /** Exact model id of the session's latest durable model selection. */
  readonly model: string
  /** Estimated historical cost in USD; null when route attribution, route eligibility, or a required price is unavailable; never a fabricated 0. */
  readonly costUsd: number | null
}

/** Why one OpenRouter spend read could not complete. */
export type OpenRouterSpendFailureReason =
  | 'not-configured' | 'unauthorized' | 'rate-limited' | 'unreachable' | 'malformed-response'

/** One failed OpenRouter spend read; `detail` never carries the credential or any part of it. */
export interface OpenRouterSpendFailure {
  /** Stable machine-readable failure class. */
  readonly reason: OpenRouterSpendFailureReason
  /** Human-readable explanation that names no secret. */
  readonly detail: string
}

/** Point-in-time OpenRouter spend answer for one session. */
export interface OpenRouterSpendSnapshot {
  /** The configured key's current usage. */
  readonly key: OpenRouterKeyUsage
  /** The session's estimate; null when the session is not live or has no model selection. */
  readonly session: OpenRouterSessionSpend | null
  /** Epoch milliseconds at which the key reading completed. */
  readonly fetchedAt: number
}

/** Result of one `openrouterSpend/read` Remote call. */
export type OpenRouterSpendReadResult =
  | { readonly ok: true; readonly value: OpenRouterSpendSnapshot }
  | { readonly ok: false; readonly error: OpenRouterSpendFailure }

/** Request for one `openrouterSpend/read` Remote call. */
export interface OpenRouterSpendReadRequest {
  /** Session whose model selection and token usage price the estimate. */
  readonly sessionId: SessionId
}
