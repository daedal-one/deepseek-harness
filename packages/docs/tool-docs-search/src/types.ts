/**
 * Package-owned type declarations for the `docs_search` Consumer tool. The seam vocabulary
 * (requests, hits, status) is owned by `@deepseek-ai/dsh-docs-search`; this module holds
 * only the shapes this Consumer itself defines.
 * @module @deepseek-ai/dsh-tool-docs-search/types
 */

import type { DocsSearchKind, DocsSearchResult } from '@deepseek-ai/dsh-docs-search'

/**
 * Tool argument shape after the registry's schema validation, before the hand checks the
 * DSL cannot express.
 */
export interface DocsSearchArgs {
  readonly query: string
  readonly kind?: DocsSearchKind
  readonly limit?: number
}

/** The canonical value the `docs_search` tool returns, before rendering. */
export interface DocsSearchToolResult {
  /** The retained hits, in service rank order, with snippets re-bounded to the deployment budget. */
  readonly hits: readonly DocsSearchResult[]
  /** Whether the index was building at call time; results are lexical-only meanwhile. */
  readonly building: boolean
}
