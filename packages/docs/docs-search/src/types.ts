/**
 * Provider-independent vocabulary of the `ctx.docsSearch` capability seam.
 * @module @deepseek-ai/dsh-docs-search/types
 */

import type { JobId } from '@deepseek-ai/dsh-jobs'

/**
 * Corpus a chunk was extracted from. The kind is fixed by where the file lives:
 * a package README, a generated catalog, a subsystem reference, an Agent Note,
 * a task specification, or a user guide.
 */
export type DocsSourceKind = 'readme' | 'catalog' | 'subsystem' | 'note' | 'spec' | 'guide'

/**
 * Requested scope of one search. `all` searches every corpus kind; any other
 * value restricts the search to that kind. A restricted search still returns
 * the same result vocabulary, so a caller can always read `source`.
 */
export type DocsSearchKind = 'all' | DocsSourceKind

/**
 * Per-arm retrieval scores attached to one result. Each arm is absent when that
 * arm contributed no ranking for the chunk, which is how a caller distinguishes
 * a lexical-only hit from a semantic-only one.
 */
export interface DocsSearchArms {
  /** Provider-native lexical score, present when the full-text arm ranked this chunk. */
  lexical?: number
  /** Provider-native semantic score, present when the vector arm ranked this chunk. */
  semantic?: number
}

/**
 * One located documentation section. Results locate text; they never carry a
 * complete section body, so a caller reads `file` at `anchor` for full content.
 */
export interface DocsSearchResult {
  /** Corpus the section was extracted from. */
  source: DocsSourceKind
  /** Repository-relative path of the owning Markdown file. */
  file: string
  /** Markdown heading slug or package-section id that addresses the section inside `file`. */
  anchor: string
  /** Section title as extracted, without the leading `#` markers. */
  title: string
  /** Bounded plain-text excerpt from the section body. */
  snippet: string
  /** Provider-computed rank score; higher ranks first. */
  score: number
  /** Which retrieval arms ranked this result, and with what provider-native score. */
  arms: DocsSearchArms
}

/** One search request over the documentation corpus. */
export interface DocsSearchRequest {
  /** Caller query text. Interpreted as data, never as index or match syntax. */
  query: string
  /** Corpus kind to restrict the search to; `all` searches every kind. */
  kind?: DocsSearchKind
  /** Maximum number of results. Bounded by the provider's configured maximum. */
  limit?: number
}

/**
 * Read-only observation of the index and its semantic arm. Reported before any
 * build runs, so a caller can distinguish "not built yet" from "built empty".
 */
export interface DocsSearchStatus {
  /** Number of chunks currently stored in the index. */
  chunks: number
  /** Number of corpus files represented in the last committed index. */
  indexed: number
  /** Whether the embedding model is loaded. */
  modelReady: boolean
  /** Whether an index build is running now. */
  building: boolean
  /**
   * Reason the index or semantic arm is unavailable, or the last build failed.
   * Absence does not prove that the on-disk corpus has not changed.
   */
  lastError?: string
}

/** Handle returned by {@link DocsSearcher.reindex} for the scheduled build. */
export interface DocsReindexHandle {
  /** Registry-issued id of the background build job, absent when no job runtime is mounted. */
  jobId?: JobId
}
