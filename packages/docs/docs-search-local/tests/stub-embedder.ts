/**
 * Deterministic embedder stand-in for docs-search tests.
 *
 * Real weights are out of scope for a keyless, offline suite. The stub derives
 * a stable vector from a text hash by the bag-of-token construction: each token
 * is hashed into one dimension, so two texts sharing tokens land near each
 * other and a text shares nothing with an unrelated one. That is enough to
 * prove the semantic arm ranks, fuses, and degrades without proving model
 * quality.
 * @module ./stub-embedder
 */

import { createHash } from 'node:crypto'
import {
  DOCS_SEARCH_DOCUMENT_PREFIX,
  DOCS_SEARCH_QUERY_PREFIX,
  DOCS_SEARCH_TITLE_PREFIX,
  type DocsEmbedder,
} from '../src/embedder.ts'

/** One recorded embedding call, in the order the provider issued it. */
export interface EmbedCall {
  /** How many documents the call embedded. */
  count: number
  /** Whether the call was a query embedding rather than a document batch. */
  query: boolean
}

/**
 * Build a deterministic stub embedder.
 * @param dimensions - vector width to emit; the real provider truncates to this width.
 * @param log - optional sink receiving one entry per call, used to prove incremental re-indexing.
 * @returns an embedder whose vectors are deterministic in the text.
 */
export function stubEmbedder(dimensions = 16, log: EmbedCall[] = []): DocsEmbedder {
  return {
    async embedDocs(titles, bodies) {
      log.push({ count: bodies.length, query: false })
      return bodies.map((body, index) => vectorOf(
        `${DOCS_SEARCH_TITLE_PREFIX}${titles[index] ?? 'none'} | ${DOCS_SEARCH_DOCUMENT_PREFIX}${body}`,
        dimensions,
      ))
    },
    async embedQuery(text) {
      log.push({ count: 1, query: true })
      return vectorOf(`${DOCS_SEARCH_QUERY_PREFIX}${text}`, dimensions)
    },
  }
}

/**
 * Derive a stable unit vector from text.
 * @param text - text to embed.
 * @param dimensions - vector width.
 * @returns the normalized bag-of-token vector.
 */
export function vectorOf(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0)
  for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const digest = createHash('sha256').update(token).digest()
    const index = digest.readUInt32BE(0) % dimensions
    vector[index] = (vector[index] ?? 0) + 1
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  /* v8 ignore next -- every call site embeds text with at least one token */
  if (norm === 0) return vector
  return vector.map(value => value / norm)
}
