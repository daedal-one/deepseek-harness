/**
 * Model-facing `docs_search` Consumer tool over the documentation-search capability seam
 * (`ctx.docsSearch`). The tool owns everything Consumer-specific — the model-facing schema,
 * the argument bounds the DSL cannot express, the deployment's result and snippet budgets,
 * and the bounded markdown render — and calls the service's frozen `search()`/`status()`
 * contract exactly as declared; it never reads files itself. Locate-then-read: the result
 * tells the model WHERE a section lives (`file` + `anchor`) and renders a bounded excerpt,
 * and the final line points the model at reading the file for the full text.
 *
 * The `docsSearch` injection is declared, so a composition that mounts this plugin without
 * a documentation-search provider leaves the fiber pending and the `docs_search` tool never
 * registers — the missing referent refuses to load instead of failing at call time.
 *
 * @module @deepseek-ai/dsh-tool-docs-search
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DOCS_SEARCH_KINDS,
  DOCS_SEARCH_SOURCES,
  LIMIT_MAX,
  LIMIT_MIN,
  QUERY_MAX_CHARS,
  boundSnippet,
  formatDocsSearchResult,
  validateDocsSearchArgs,
} from './format.ts'
import type { DocsSearchKind, DocsSearchRequest } from '@deepseek-ai/dsh-docs-search'
// The ctx.docsSearch Context merge is owned by the Service Definition package; the
// type-only imports below keep its declarations in this package's program. This re-export
// projects the package-owned shapes in src/types.ts onto the package root.
export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-docs-search'

/** Services the tool requires; the composition refuses to mount it without both. */
export const inject = ['tools', 'docsSearch']

/** The result-limit ceiling when a deployment states no tighter cap: the schema's own maximum. */
export const DEFAULT_RESULT_LIMIT_CAP = LIMIT_MAX

/** The default per-hit snippet budget in characters; a deployment tightens it for its models. */
export const DEFAULT_SNIPPET_CHARS = 200

/** Model-facing `docs_search` configuration; both fields are deployment-varying choices. */
export interface Config {
  /** Maximum forwarded `limit`; an explicit model limit above it is rejected naming the cap. */
  resultLimitCap?: number
  /** Per-hit snippet budget in characters applied to the returned value's snippets. */
  snippetChars?: number
}

/** Schemastery configuration for the docs_search tool consumer. */
export const Config: z<Config> = z.object({
  resultLimitCap: z.number().default(DEFAULT_RESULT_LIMIT_CAP),
  snippetChars: z.number().default(DEFAULT_SNIPPET_CHARS),
})

/** The shape after schemastery applied both defaults. */
type ResolvedConfig = Required<Config>

/** Model-facing tool description, pinned so tests and docs quote the exact text. */
const DESCRIPTION =
  'Search the repository documentation (READMEs, package catalogs, subsystem pages, '
  + 'agent notes, specs, and guides) for sections relevant to a query. Returns a bounded '
  + 'list of hits, each with its file, anchor, and a one-line snippet. Use it to locate '
  + 'where something is documented, then read the file at the anchor for the full text — '
  + 'the snippets are excerpts, not substitutes.'

/** Positive-integer check for the deployment's budgets, failing loud at load. */
function assertConfigInteger(field: string, value: number, maximum?: number): void {
  if (!Number.isInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    const range = maximum === undefined ? 'a positive integer' : `an integer between 1 and ${maximum}`
    throw new Error(`tool-docs-search: ${field} must be ${range}`)
  }
}

/**
 * Register the `docs_search` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the `docsSearch` service.
 * @param config - deployment's result and snippet budgets.
 */
export function apply(ctx: Context, config: Config): void {
  // Schemastery (Config) has already filled both defaulted fields.
  const resolved = config as ResolvedConfig
  assertConfigInteger('resultLimitCap', resolved.resultLimitCap, LIMIT_MAX)
  assertConfigInteger('snippetChars', resolved.snippetChars)

  ctx.tools.register(defineTool({
    name: 'docs_search',
    description: DESCRIPTION,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: `What to look for, 1-${QUERY_MAX_CHARS} characters.`,
      },
      kind: {
        type: 'string',
        enum: [...DOCS_SEARCH_KINDS],
        description: 'Restrict the search to one documentation source. Omit to search all sources.',
      },
      limit: {
        type: 'integer',
        description: `Maximum number of hits to return, ${LIMIT_MIN}-${LIMIT_MAX}. Omit for the service default.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true, enum: [...DOCS_SEARCH_SOURCES] },
                file: { type: 'string', required: true },
                anchor: { type: 'string', required: true },
                title: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
                score: { type: 'number', required: true },
                arms: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    lexical: { type: 'number' },
                    semantic: { type: 'number' },
                  },
                },
              },
            },
          },
          building: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatDocsSearchResult(value) }],
    },
    async execute(args, exec) {
      validateDocsSearchArgs(args, resolved.resultLimitCap)
      exec.signal.throwIfAborted()
      // The service owns ranking, truncation to a requested limit, and index health; the
      // query travels unchanged. `status()` is a synchronous read on the frozen contract,
      // so one awaited search carries the whole pass: a service rejection fails the call
      // loudly instead of degrading one face silently. An over-cap limit was already
      // rejected above, so the forwarded values always sit inside the deployment's bounds.
      const status = ctx.docsSearch.status()
      const hits = await ctx.docsSearch.search(buildRequest(args))
      exec.signal.throwIfAborted()
      return {
        building: status.building,
        hits: hits.slice(0, args.limit).map(hit => ({
          source: hit.source,
          file: hit.file,
          anchor: hit.anchor,
          title: hit.title,
          snippet: boundSnippet(hit.snippet, resolved.snippetChars),
          score: hit.score,
          arms: hit.arms,
        })),
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Docs search: ${args.query}`,
      kind: 'search',
      rawInput: args.query,
    }),
  }))
}

/**
 * Build the service request with only the fields the model actually sent, so the recorded
 * request mirrors the call instead of carrying undefined members.
 * @param args - validated model arguments.
 * @returns the request the service receives.
 */
function buildRequest(args: { query: string; kind?: DocsSearchKind; limit?: number }): DocsSearchRequest {
  return {
    query: args.query,
    ...(args.kind !== undefined ? { kind: args.kind } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  }
}
