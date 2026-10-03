/**
 * Browser-safe vocabulary for durable conversation summaries: the ONE home of
 * the `summary` projection-key declaration, free of this package's host-side
 * value imports (cordis, schemastery, the LLM seam). Two namespace projections
 * serve it — `./types` for host consumers and `./client` for client aggregates
 * — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-summary-llm/types
 */

export {}

import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Exact auxiliary model route that produced one accepted summary revision. */
export interface SessionSummaryRoute {
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
}

/** Payload of the log-only `session/summary` event. */
export interface SessionSummaryEventData {
  /** Turn whose close triggered this revision. */
  readonly turn: number
  /** Monotonic per-session revision number. */
  readonly revision: number
  /** Normalized non-empty summary text. */
  readonly summary: string
  /** Exact source-entry seqs folded by this revision. */
  readonly sourceSeqs: SessionSeq[]
  /** Highest session seq this summary accounts for. */
  readonly throughSeq: SessionSeq
  /** Auxiliary route that produced the revision. */
  readonly route: SessionSummaryRoute
}

/** Client-view value of the `summary` projection: the latest accepted text, or `null`. */
export type SummaryProjection = string | null

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest logged conversation summary text, or null. */
    summary: string | null
  }
  interface SessionProjectionMap {
    /**
     * The session's latest accepted conversation summary, or `null` before one
     * lands. A plain string: the shape the client list rows consume.
     */
    summary: string | null
  }
}
