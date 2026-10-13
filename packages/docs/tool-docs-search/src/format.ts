/**
 * Pure model-facing formatting and input validation for the `docs_search` tool: argument
 * hand-checks the parameter DSL cannot express, the canonical-value snippet bound, and the
 * bounded markdown render. Everything here is a pure function of its arguments so the
 * presenters, the render, and the tests pin the exact model-visible text.
 *
 * @module @deepseek-ai/dsh-tool-docs-search/format
 */

import type { DocsSearchKind, DocsSourceKind } from '@deepseek-ai/dsh-docs-search'
import type { DocsSearchArgs, DocsSearchToolResult } from './types.ts'

/** Maximum accepted query length in Unicode code points, matching the schema guidance. */
export const QUERY_MAX_CHARS = 512

/** Minimum model-facing `limit` value. */
export const LIMIT_MIN = 1

/** Maximum model-facing `limit` value, also the schema-level protocol bound. */
export const LIMIT_MAX = 50

/** The documentation corpora the service indexes, in schema order. */
export const DOCS_SEARCH_SOURCES: readonly DocsSourceKind[] = [
  'readme',
  'catalog',
  'subsystem',
  'note',
  'spec',
  'guide',
]

/** The documentation sources the `kind` parameter names, in schema order. */
export const DOCS_SEARCH_KINDS: readonly DocsSearchKind[] = ['all', ...DOCS_SEARCH_SOURCES]

/** The final render line: the locate-then-read instruction. */
export const FINAL_LINE = 'Read the file at the anchor for the full text.'

/** The render line used while the index is building. */
export const BUILDING_LINE = 'The documentation index is still building; these results are lexical-only meanwhile.'

/** The render line used when the service returned no hits. */
export const NO_MATCHES_LINE = 'No documentation matches the query.'

/**
 * Validate the constraints the parameter DSL cannot express: a non-whitespace query within
 * the 512-character bound and a `limit` inside 1..50 that also respects the deployment's
 * result cap. The registry has already enforced types, requiredness, and the `kind` enum.
 * @param args - model-supplied arguments, already schema-checked.
 * @param resultLimitCap - the deployment's maximum forwarded `limit`.
 * @returns nothing; throws one descriptive error naming the violated bound.
 */
export function validateDocsSearchArgs(args: DocsSearchArgs, resultLimitCap: number): void {
  if (args.query.trim().length === 0) {
    throw new Error('invalid query: must be a non-empty string')
  }
  if (Array.from(args.query).length > QUERY_MAX_CHARS) {
    throw new Error(`invalid query: must be at most ${QUERY_MAX_CHARS} characters`)
  }
  if (args.limit !== undefined && (args.limit < LIMIT_MIN || args.limit > LIMIT_MAX)) {
    throw new Error(`invalid limit: must be between ${LIMIT_MIN} and ${LIMIT_MAX}`)
  }
  if (args.limit !== undefined && args.limit > resultLimitCap) {
    throw new Error(`invalid limit: exceeds the configured result limit cap (${resultLimitCap})`)
  }
}

/**
 * Bound one service snippet to the deployment's character budget: collapse whitespace to
 * single spaces, then truncate on Unicode code points so a cut never splits a surrogate
 * pair. The ellipsis is appended only when at least one character remains alongside it.
 * @param snippet - the service's bounded snippet.
 * @param snippetChars - the deployment's snippet budget in characters.
 * @returns the one-line snippet within the budget.
 */
export function boundSnippet(snippet: string, snippetChars: number): string {
  const collapsed = collapseWhitespace(snippet)
  const points = Array.from(collapsed)
  if (points.length <= snippetChars) return collapsed
  if (snippetChars > 3) return `${points.slice(0, snippetChars - 3).join('')}...`
  return points.slice(0, snippetChars).join('')
}

/** Collapse every whitespace run to one space and trim the ends. */
function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim()
}

/**
 * Render the canonical value as the bounded markdown list the model reads: one list item
 * per hit (the locator line plus its one-line snippet), the building caveat first when the
 * index was building, a no-match line instead of the list when nothing hit, and the
 * locate-then-read instruction last whenever there is something to read.
 * @param value - the canonical tool result.
 * @returns the model-facing markdown text.
 */
export function formatDocsSearchResult(value: DocsSearchToolResult): string {
  const lines: string[] = []
  if (value.building) lines.push(BUILDING_LINE)
  if (value.hits.length === 0) {
    lines.push(NO_MATCHES_LINE)
    return lines.join('\n')
  }
  for (const hit of value.hits) {
    lines.push(`- ${collapseWhitespace(hit.title)} — ${hit.file}#${hit.anchor} (${hit.source}, score ${hit.score.toFixed(2)})`)
    lines.push(`  ${collapseWhitespace(hit.snippet)}`)
  }
  lines.push(FINAL_LINE)
  return lines.join('\n')
}
