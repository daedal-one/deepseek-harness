/**
 * Query normalization, FTS5 sanitization, snippet bounding, and rank fusion for
 * the docs-search provider.
 * @module @deepseek-ai/dsh-docs-search-local/query
 */

import type { DocsSearchArms, DocsSearchResult, DocsSourceKind } from '@deepseek-ai/dsh-docs-search'
import type { ChunkHit, ChunkMetadata } from './store.ts'

/** Reciprocal-rank-fusion constant; the value the RRF paper uses and the shipped default. */
export const DOCS_SEARCH_RRF_K = 60

/** Default result limit when a request omits one. */
export const DOCS_SEARCH_DEFAULT_LIMIT = 8

/** Largest accepted result limit. */
export const DOCS_SEARCH_MAX_LIMIT = 50

/** Default snippet length in Unicode code points. */
export const DOCS_SEARCH_SNIPPET_CHARS = 240

/** Stable, machine-routable failure taxonomy for docs-search requests. */
export type DocsSearchErrorCode =
  | 'DOCS_SEARCH_INVALID_CONFIG'
  | 'DOCS_SEARCH_INVALID_QUERY'
  | 'DOCS_SEARCH_INVALID_LIMIT'
  | 'DOCS_SEARCH_INDEX_FAILED'

/** Failure raised by the docs-search provider, carrying its routable code. */
export class DocsSearchError extends Error {
  /**
   * @param message - human-readable failure detail.
   * @param code - stable code a caller may branch on.
   * @param options - optional underlying cause.
   */
  constructor(message: string, readonly code: DocsSearchErrorCode, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DocsSearchError'
  }
}

/**
 * Turn raw caller text into a safe FTS5 match expression.
 *
 * The transform treats the query as data, never as syntax. Unicode letters and
 * digits are collected into tokens; every other character — including the FTS5
 * operators `"`, `*`, `(`, `)`, `:`, `^`, `-`, and the keywords `AND`, `OR`,
 * and `NOT` — is a separator, so no caller input can reach FTS5 as an operator.
 * Tokens are emitted as a quoted phrase union, which makes a match mean "any
 * of these tokens" without letting a token that happens to spell a keyword act
 * as one. An input with no letters or digits yields an empty expression.
 * @param query - raw caller query.
 * @returns a quoted-phrase union expression, or an empty string when no token survives.
 */
export function sanitizeFtsQuery(query: string): string {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  if (tokens.length === 0) return ''
  return tokens.map(token => `"${token}"`).join(' OR ')
}

/**
 * Validate and normalize a caller query.
 * @param query - raw query text.
 * @returns whitespace-normalized query text.
 * @throws DocsSearchError with `DOCS_SEARCH_INVALID_QUERY` when the query has no searchable token.
 */
export function normalizeQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0 || sanitizeFtsQuery(normalized).length === 0) {
    throw new DocsSearchError('docs-search query must contain letters or digits', 'DOCS_SEARCH_INVALID_QUERY')
  }
  return normalized
}

/**
 * Validate a caller limit against the configured maximum.
 * @param limit - requested limit, or undefined for the configured default.
 * @param defaultLimit - limit applied when the request omits one.
 * @param maxLimit - largest accepted limit.
 * @returns the accepted limit.
 * @throws DocsSearchError with `DOCS_SEARCH_INVALID_LIMIT` when the value is not an accepted integer.
 */
export function normalizeLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  const value = limit ?? defaultLimit
  if (!Number.isSafeInteger(value) || value < 1 || value > maxLimit) {
    throw new DocsSearchError(`docs-search limit must be an integer between 1 and ${maxLimit}`, 'DOCS_SEARCH_INVALID_LIMIT')
  }
  return value
}

/** One fused candidate before metadata is attached. */
export interface FusedCandidate {
  /** Metadata row id. */
  id: number
  /** Fused reciprocal-rank score. */
  score: number
  /** Which arms ranked this candidate, with their provider-native scores. */
  arms: DocsSearchArms
}

/**
 * Fuse lexical and semantic rankings with Reciprocal Rank Fusion.
 *
 * RRF sums `1 / (k + rank)` over the arms that ranked a document, so it needs
 * no score calibration between BM25 and cosine similarity. Each arm
 * contributes independently according to its rank. Ties break on ascending chunk id, which
 * keeps repeated identical searches stable.
 * @param lexical - lexical hits in rank order.
 * @param semantic - semantic hits in rank order, empty while the vector arm is degraded.
 * @param limit - maximum fused candidates to return.
 * @returns fused candidates ordered by descending score.
 */
export function fuseRanks(
  lexical: readonly ChunkHit[],
  semantic: readonly ChunkHit[],
  limit: number,
): FusedCandidate[] {
  const fused = new Map<number, FusedCandidate>()
  const accumulate = (hits: readonly ChunkHit[], arm: 'lexical' | 'semantic'): void => {
    hits.forEach((hit, index) => {
      const candidate = fused.get(hit.id) ?? { id: hit.id, score: 0, arms: {} }
      candidate.score += 1 / (DOCS_SEARCH_RRF_K + index + 1)
      candidate.arms[arm] = hit.score
      fused.set(hit.id, candidate)
    })
  }
  accumulate(lexical, 'lexical')
  accumulate(semantic, 'semantic')
  return [...fused.values()]
    .sort((left, right) => right.score - left.score || left.id - right.id)
    .slice(0, limit)
}

/**
 * Build a bounded plain-text snippet from a stored chunk body.
 *
 * Whitespace is folded to single spaces so a snippet reads as one line, and an
 * excerpt longer than the budget is cut at a word boundary where one exists
 * near the budget.
 * @param body - stored chunk body.
 * @param maxChars - maximum snippet length in Unicode code points.
 * @returns the bounded snippet.
 */
export function makeSnippet(body: string, maxChars: number): string {
  const folded = body.replace(/\s+/gu, ' ').trim()
  const characters = Array.from(folded)
  if (characters.length <= maxChars) return folded
  const cut = characters.slice(0, maxChars - 1).join('')
  const boundary = cut.lastIndexOf(' ')
  const kept = boundary > Math.floor(maxChars / 2) ? cut.slice(0, boundary) : cut
  return `${kept.trimEnd()}…`
}

/**
 * Attach fused scores and snippets to stored metadata rows.
 * @param metadata - metadata rows for the fused candidates.
 * @param fused - fused candidates in rank order.
 * @param snippetChars - snippet budget in Unicode code points.
 * @returns results in the fused rank order, carrying only the rows that still exist.
 */
export function toResults(
  metadata: readonly ChunkMetadata[],
  fused: readonly FusedCandidate[],
  snippetChars: number,
): DocsSearchResult[] {
  const byId = new Map(metadata.map(row => [row.id, row]))
  const results: DocsSearchResult[] = []
  for (const candidate of fused) {
    const row = byId.get(candidate.id)
    if (row === undefined) continue
    results.push({
      source: row.kind,
      file: row.file,
      anchor: row.anchor,
      title: row.title,
      snippet: makeSnippet(row.body, snippetChars),
      score: candidate.score,
      arms: candidate.arms,
    })
  }
  return results
}

/**
 * Map a requested kind onto the corpus kinds a search may return.
 * @param kind - requested kind, or undefined for every kind.
 * @returns the accepted corpus kinds, or an empty list meaning "no kind restriction".
 */
export function filterKinds(kind: string | undefined): DocsSourceKind[] {
  if (kind === undefined || kind === 'all') return []
  const kinds: readonly string[] = ['readme', 'catalog', 'subsystem', 'note', 'spec', 'guide']
  if (!kinds.includes(kind)) {
    throw new DocsSearchError(`docs-search kind "${kind}" is not a corpus kind`, 'DOCS_SEARCH_INVALID_LIMIT')
  }
  return [kind as DocsSourceKind]
}
