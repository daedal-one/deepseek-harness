/**
 * Service Definition for the `ctx.docsSearch` capability seam: local hybrid
 * retrieval over the repository's own documentation corpus. The seam owns the
 * request, result, and status vocabulary; a provider owns chunking, the index
 * store, ranking, and lifecycle.
 * @module @deepseek-ai/dsh-docs-search
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  DocsReindexHandle,
  DocsSearchRequest,
  DocsSearchResult,
  DocsSearchStatus,
} from './types.ts'

export type {
  DocsReindexHandle,
  DocsSearchArms,
  DocsSearchKind,
  DocsSearchRequest,
  DocsSearchResult,
  DocsSearchStatus,
  DocsSourceKind,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    docsSearch: DocsSearcher
  }
}

/**
 * Abstract hybrid documentation search service. Subclass, implement the
 * abstract methods, and load the subclass as a plugin — it registers as
 * `ctx.docsSearch` (one implementation per context; loading a second throws,
 * which is cordis' standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - {@link search} resolves with ranked results even while the semantic arm is
 *   degraded or an index build is running; it rejects only for a rejected
 *   request (blank query, out-of-range limit) or an unusable index.
 * - A result locates a section by `file` and `anchor` and carries only a
 *   bounded excerpt. The complete section body is never returned.
 * - {@link reindex} returns as soon as a build is scheduled. Callers observe
 *   progress through {@link status}.
 * - Missing embedding assets leave lexical retrieval available. An unusable
 *   store prevents both arms from searching. Failures appear in
 *   {@link DocsSearchStatus.lastError}.
 */
export abstract class DocsSearcher extends Service {
  constructor(ctx: Context) {
    // `abstract` erases at runtime, so a composition row naming this package
    // would register a ctx.docsSearch with no method implementations and fail
    // far from the misconfiguration. Fail loud at load instead.
    if (new.target === DocsSearcher) {
      throw new Error('@deepseek-ai/dsh-docs-search is the abstract docs-search seam; load an implementation such as @deepseek-ai/dsh-docs-search-local instead')
    }
    super(ctx, 'docsSearch')
  }

  /**
   * Search the documentation corpus with lexical and semantic retrieval.
   * @param request - query text, optional corpus kind, and optional result limit.
   * @returns ranked section locations, highest score first.
   * @throws when the query is blank or `limit` is outside the provider's accepted range.
   */
  abstract search(request: DocsSearchRequest): Promise<DocsSearchResult[]>

  /**
   * Read the current index and semantic-arm state without mutating either.
   * @returns stored chunk and file counts, model readiness, build progress, and the last degradation reason.
   */
  abstract status(): DocsSearchStatus

  /**
   * Schedule an index build that brings stored chunks in line with the corpus.
   * @returns the scheduled build's background job id, absent when no job runtime is mounted.
   */
  abstract reindex(): DocsReindexHandle
}

export default DocsSearcher
