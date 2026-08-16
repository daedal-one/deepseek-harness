/**
 * MCP client bridge plugin: connects to an external MCP server and registers
 * its tools on `ctx.tools` under server-qualified public names
 * (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
 * server; load multiple instances in `cordis.yml` for multiple servers.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * and releases the `serverName` namespace reservation inside this composition
 * scope. HMR hot-swaps by disposing the old instance and creating a new one;
 * identical `serverName` reproduces identical public tool names.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from './connection.ts'
import type { ReconnectConfig } from './connection.ts'
import type { UrlHostBinding } from './tools.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'

export type { McpResult } from './tools.ts'
export type { UrlHostBinding } from './tools.ts'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/** Default timeout for individual MCP tool calls (ms). */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Valid `serverName`, kept below the public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Live `serverName` reservations per composition scope. Separate standing
 * preset generations may publish the same reviewed public namespace into
 * their own scoped tool layers; duplicates inside one scope fail at load.
 */
const activeServerNames = new WeakMap<object, Set<string>>()

/** Connection ownership for model tool calls. */
export type ClientLifetime = 'plugin' | 'agent'

/** MCP discovery and argument projection shared by both transports. */
export interface ToolProjectionConfig {
  /** Exact raw MCP tool names to publish; omission publishes the complete server list. */
  includeTools?: string[]
  /** Raw argument names removed from every published input schema. */
  removeArguments?: string[]
  /** Raw string arguments removed from schemas and bound to the executing Agent session id. */
  bindSessionArguments?: string[]
  /** Exact tools whose hidden provider domain argument is derived from a model URL argument. */
  urlHostBindings?: UrlHostBinding[]
  /** Reuse one MCP client or create one isolated client per executing Agent. */
  clientLifetime: ClientLifetime
}

// ---- Config ----

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig extends ToolProjectionConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Managed process-tree TERM-to-KILL grace in milliseconds. */
  processGraceMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig extends ToolProjectionConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

type StdioConfigInput = Omit<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
type StreamableHttpConfigInput = Omit<StreamableHttpConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StreamableHttpConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
type ConfigInput = StdioConfigInput | StreamableHttpConfigInput

const Reconnect: z<ReconnectConfig> = z.object({
  enabled: z.boolean().default(RECONNECT_DEFAULTS.enabled),
  initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts),
})

export const Config = z.union([
  z.object({
    transport: z.const('stdio'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    toolCallTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    processGraceMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(2_000),
    failOnStartupError: z.boolean().default(false),
    reconnect: Reconnect,
    includeTools: z.array(String).default(undefined as unknown as string[]),
    removeArguments: z.array(String).default(undefined as unknown as string[]),
    bindSessionArguments: z.array(String).default(undefined as unknown as string[]),
    urlHostBindings: z.array(z.object({
      tool: z.string().required(),
      sourceArgument: z.string().required(),
      targetArgument: z.string().required(),
    })).default(undefined as unknown as UrlHostBinding[]),
    clientLifetime: z.union(['plugin', 'agent'] as const).default('plugin'),
  }),
  z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    reconnect: Reconnect,
    includeTools: z.array(String).default(undefined as unknown as string[]),
    removeArguments: z.array(String).default(undefined as unknown as string[]),
    bindSessionArguments: z.array(String).default(undefined as unknown as string[]),
    urlHostBindings: z.array(z.object({
      tool: z.string().required(),
      sourceArgument: z.string().required(),
      targetArgument: z.string().required(),
    })).default(undefined as unknown as UrlHostBinding[]),
    clientLifetime: z.union(['plugin', 'agent'] as const).default('plugin'),
  }),
]) as unknown as z<ConfigInput, Config>

// ---- Plugin apply ----

/**
 * Connect one MCP server and publish its initial tool generation before activation.
 * This entry remains explicitly `async`: Cordis treats a prototype-bearing
 * ordinary function as a constructor, whose returned Promise is not startup work.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved transport and server namespace configuration.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Fail loud at load: reconnect misconfiguration (including programmatic
  // construction that bypassed Schemastery) rejects THIS instance before any
  // effect registers.
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`)
  validateProjection(config)

  // Reserve the namespace next: a duplicate `serverName` fails THIS instance
  // at load with an actionable error and leaves the earlier instance intact.
  ctx.effect(() => {
    const namespace = scopeOf(ctx) ?? ctx.root
    let names = activeServerNames.get(namespace)
    if (!names) {
      names = new Set()
      activeServerNames.set(namespace, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(
        `mcp-client: serverName "${config.serverName}" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml`,
      )
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'mcp-client.serverName')

  // The supervisor owns the client/transport generations, the reconnect
  // loop, and the live tool registrations; disposal stops reconnection,
  // quiesces in-flight work, and unregisters the current generation.
  const connection = startConnection(ctx, config, reconnect)

  ctx.effect(() => {
    return () => connection.dispose()
  }, 'mcp-client.connection')

  // Block plugin activation on the initial connection + tool discovery so
  // Cordis consumers observe the tools immediately after the fiber activates.
  // When failOnStartupError is true, a failed initial attempt rejects the
  // fiber (Cordis rolls it back); otherwise the error is logged and the
  // supervisor enters its reconnect loop.
  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }
}

/** Reject ambiguous or ineffective projection configuration before connecting. */
function validateProjection(config: Config): void {
  if (!Number.isFinite(config.toolCallTimeoutMs) || config.toolCallTimeoutMs < 1 || config.toolCallTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`mcp-client(${config.serverName}): toolCallTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (config.transport === 'stdio' && (!Number.isFinite(config.processGraceMs) || config.processGraceMs < 1 || config.processGraceMs > MAX_TIMER_DELAY_MS)) {
    throw new Error(`mcp-client(${config.serverName}): processGraceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const lists = [
    ['includeTools', config.includeTools],
    ['removeArguments', config.removeArguments],
    ['bindSessionArguments', config.bindSessionArguments],
  ] as const
  for (const [field, values] of lists) {
    if (values === undefined) continue
    if (values.length === 0) throw new Error(`mcp-client(${config.serverName}): ${field} must not be empty when present`)
    if (values.some(value => value.trim().length === 0)) {
      throw new Error(`mcp-client(${config.serverName}): ${field} entries must be non-empty`)
    }
    if (new Set(values).size !== values.length) {
      throw new Error(`mcp-client(${config.serverName}): ${field} entries must be unique`)
    }
  }
  const removed = new Set(config.removeArguments)
  const overlap = config.bindSessionArguments?.find(argument => removed.has(argument))
  if (overlap !== undefined) {
    throw new Error(`mcp-client(${config.serverName}): argument ${JSON.stringify(overlap)} cannot be removed and session-bound`)
  }
  const bindings = config.urlHostBindings ?? []
  const bindingKeys = bindings.map(binding => `${binding.tool}\0${binding.targetArgument}`)
  if (bindings.some(binding => binding.tool.trim().length === 0
    || binding.sourceArgument.trim().length === 0
    || binding.targetArgument.trim().length === 0
    || binding.sourceArgument === binding.targetArgument)) {
    throw new Error(`mcp-client(${config.serverName}): URL-host bindings require non-empty, distinct tool/source/target names`)
  }
  if (new Set(bindingKeys).size !== bindingKeys.length) {
    throw new Error(`mcp-client(${config.serverName}): URL-host binding targets must be unique per tool`)
  }
  const invalidBinding = bindings.find(binding => !removed.has(binding.targetArgument)
    || config.bindSessionArguments?.includes(binding.sourceArgument) === true
    || removed.has(binding.sourceArgument)
    || (config.includeTools !== undefined && !config.includeTools.includes(binding.tool)))
  if (invalidBinding !== undefined) {
    throw new Error(`mcp-client(${config.serverName}): URL-host binding ${JSON.stringify(invalidBinding.tool)} must target a removed argument on an included tool without hiding its source`)
  }
}
