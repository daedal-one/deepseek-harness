/** Deferred tool search and admission reconstructed from settled tool results. @module */

import MiniSearch from 'minisearch'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { ToolDefinition } from './index.ts'
import { defineTool } from './schema.ts'

/** Opt-in limits and tool-name prefixes for deferred model presentation. */
export interface ToolDiscoveryConfig {
  /** Non-empty literal prefixes of deferred tool names, for example `mcp__`. */
  readonly prefixes: readonly string[]
  /** Search result count when the model omits limit. */
  readonly defaultLimit: number
  /** Maximum result count accepted from the model. */
  readonly maxLimit: number
  /** Maximum UTF-8 bytes accepted in a search query. */
  readonly maxQueryBytes: number
  /** Maximum UTF-8 bytes in the complete JSON search result. */
  readonly maxResultBytes: number
}

interface Admission {
  offset: SessionLogOffset
  readonly calls: Set<ToolCallId>
  readonly names: Set<string>
}

const SEARCH_NAME = 'tool_search'
const EMPTY_RESULT_BYTES = Buffer.byteLength(JSON.stringify({ tools: [], truncated: false }))

/**
 * Validate and detach the opt-in discovery configuration.
 * @param config - deployment-owned search limits and literal prefixes.
 * @returns detached configuration, or undefined when discovery is disabled.
 */
export function resolveDiscovery(config: ToolDiscoveryConfig | undefined): ToolDiscoveryConfig | undefined {
  if (config === undefined) return undefined
  if (config.prefixes.length === 0 || config.prefixes.some(prefix => prefix.trim().length === 0)) {
    throw new Error('tools.discovery.prefixes must contain non-empty literal prefixes')
  }
  if (new Set(config.prefixes).size !== config.prefixes.length) throw new Error('tools.discovery.prefixes must be unique')
  for (const key of ['defaultLimit', 'maxLimit', 'maxQueryBytes', 'maxResultBytes'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`tools.discovery.${key} must be a positive safe integer`)
  }
  if (config.defaultLimit > config.maxLimit) throw new Error('tools.discovery.defaultLimit must not exceed maxLimit')
  if (config.maxResultBytes < EMPTY_RESULT_BYTES) throw new Error(`tools.discovery.maxResultBytes must be at least ${EMPTY_RESULT_BYTES}`)
  if (config.prefixes.some(prefix => SEARCH_NAME.startsWith(prefix) || 'run_code'.startsWith(prefix))) {
    throw new Error('tools.discovery.prefixes must not defer tool_search or run_code')
  }
  return { ...config, prefixes: [...config.prefixes] }
}

function admittedNames(content: readonly ContentBlock[]): readonly string[] {
  if (content.length !== 1 || content[0]?.type !== 'text') return []
  let value: unknown
  try { value = JSON.parse(content[0].text) } catch { return [] /* Non-JSON post-execution output cannot admit tools. */ }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.truncated !== 'boolean'
    || !Array.isArray(record.tools) || !record.tools.every((name): name is string => typeof name === 'string')) return []
  return record.tools
}

/** Registry-owned search tool; its only retained state is a rebuildable Session fold. */
export class ToolDiscovery {
  /** Search definition registered for the owning ToolRuntime lifetime. */
  readonly tool: ToolDefinition
  private readonly admissions = new WeakMap<Session, Admission>()

  constructor(private readonly config: ToolDiscoveryConfig, definitions: (scope?: ScopeKey) => readonly ToolDefinition[]) {
    this.tool = defineTool({
      name: SEARCH_NAME,
      description: `Search available specialist tools by name or description. Tools whose names start with ${config.prefixes.join(', ')} must be discovered before use. Matching tools become available after this search completes; use them on your next request or program.`,
      parameters: {
        query: { type: 'string', required: true, description: 'Describe the capability or name of the tool you need.' },
        limit: { type: 'integer', description: `Maximum number of tools to load; defaults to ${config.defaultLimit}, at most ${config.maxLimit}.` },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: { tools: { type: 'array', items: { type: 'string' }, required: true }, truncated: { type: 'boolean', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => false,
      execute: (args, exec) => {
        exec.signal.throwIfAborted()
        if (exec.agent === undefined) throw new Error('tool_search requires an agent session')
        const query = args.query.trim()
        if (query.length === 0 || Buffer.byteLength(args.query) > config.maxQueryBytes) {
          throw new Error(`query must be non-empty and at most ${config.maxQueryBytes} UTF-8 bytes`)
        }
        const limit = args.limit ?? config.defaultLimit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > config.maxLimit) {
          throw new Error(`limit must be an integer from 1 to ${config.maxLimit}`)
        }
        const candidates = definitions(exec.agent).filter(tool => this.isDeferred(tool.name))
          .sort((left, right) => left.name < right.name ? -1 : 1)
        const index = new MiniSearch<ToolDefinition>({ idField: 'name', fields: ['name', 'description'] })
        index.addAll(candidates)
        const ranked = index.search(query).sort((left, right) => right.score - left.score || (String(left.id) < String(right.id) ? -1 : 1))
        const result: { tools: string[]; truncated: boolean } = { tools: [], truncated: false }
        for (const hit of ranked) {
          const name = String(hit.id)
          const proposed = { tools: [...result.tools, name], truncated: false }
          if (result.tools.length === limit || Buffer.byteLength(JSON.stringify(proposed)) > config.maxResultBytes) {
            result.truncated = true
            break
          }
          result.tools.push(name)
        }
        return Promise.resolve(result)
      },
    })
  }

  /**
   * Test the deployment's literal name prefixes.
   * @param name - registered tool name.
   * @returns whether the name belongs to the deferred set.
   */
  isDeferred(name: string): boolean {
    return this.config.prefixes.some(prefix => name.startsWith(prefix))
  }

  /**
   * Read admission from committed native or programmatic search settlements.
   * @param name - current registered tool name; authorization is checked by the registry.
   * @param session - exact calling session, absent for diagnostic or agentless calls.
   * @returns whether the name may be presented or executed in this session.
   */
  admits(name: string, session?: Session): boolean {
    if (!this.isDeferred(name)) return true
    if (session === undefined) return false
    let state = this.admissions.get(session)
    if (state === undefined) {
      state = { offset: SessionLogOffset(0), calls: new Set(), names: new Set() }
      this.admissions.set(session, state)
    }
    if (state.offset === session.seq) return state.names.has(name)
    for (const event of session.snapshotEvents(state.offset)) {
      if (event.type === 'tool/call' && event.data.name === SEARCH_NAME) state.calls.add(event.data.callId)
      if (event.type === 'tool/result') {
        const result = event.data.message.content[0]
        if (state.calls.delete(result.toolCallId) && !result.isError) {
          for (const admitted of admittedNames(result.content)) state.names.add(admitted)
        }
      }
      if (event.type === 'tool/ptc-dispatch' && event.data.name === SEARCH_NAME && !event.data.isError) {
        for (const admitted of admittedNames(event.data.content)) state.names.add(admitted)
      }
    }
    state.offset = session.seq
    return state.names.has(name)
  }
}
