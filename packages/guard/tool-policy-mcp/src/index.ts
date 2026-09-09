/** Deterministic policy for exact MCP tools and public URL arguments. @module */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ToolPolicyProviderId,
  type ToolPolicyDecision,
  type ToolPolicyProvider,
  type ToolPolicyRequest,
  type ToolPolicyVerdict,
} from '@deepseek-ai/dsh-tool-policy'
import { resolvePublicAddresses } from '@deepseek-ai/dsh-web-fetch-http'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

export const name = 'tool-policy-mcp'
export const inject = ['toolPolicy']

/** One exact public MCP tool's deterministic authorization rule. */
export interface McpToolRule {
  /** Exact public `mcp__...` tool name observed at execution time. */
  readonly tool: string
  /** Deterministic authorization verdict for a valid matching call. */
  readonly decision: ToolPolicyDecision
  /** Audit risk score from zero through one hundred. */
  readonly risk: number
  /** Non-empty secret-free audit categories. */
  readonly categories: readonly string[]
  /** Secret-free audit explanation for the configured verdict. */
  readonly reason: string
  /** Trusted child principals allowed to execute this tool; omission permits every Agent. */
  readonly principals?: readonly string[]
  /** Root string or string-array arguments that must contain public HTTP(S) URLs when present. */
  readonly urlArguments: readonly string[]
  /** Root arguments whose presence is an unconditional policy denial. */
  readonly forbiddenArguments: readonly string[]
}

/** MCP policy provider configuration. */
export interface Config {
  /** Stable provider id registered with `ctx.toolPolicy`. */
  readonly id: string
  /** Exact public MCP tool rules; tool names must be unique. */
  readonly rules: readonly McpToolRule[]
}

const decisionSchema = z.union(['allow', 'ask', 'deny'] as const)

export const Config: z<Config> = z.object({
  id: z.string().required(),
  rules: z.array(z.object({
    tool: z.string().required(),
    decision: decisionSchema.required(),
    risk: z.number().step(1).min(0).max(100).required(),
    categories: z.array(String).required(),
    reason: z.string().required(),
    principals: z.array(String),
    urlArguments: z.array(String).required(),
    forbiddenArguments: z.array(String).required(),
  })).required(),
}) as z<Config>

/** Build a bounded policy verdict without retaining tool arguments. */
function verdict(
  providerId: string,
  decision: ToolPolicyDecision,
  risk: number,
  categories: readonly string[],
  reason: string,
): ToolPolicyVerdict {
  return {
    providerId: ToolPolicyProviderId(providerId),
    decision,
    risk,
    categories,
    reason,
    opinions: [],
  }
}

/** Read one root argument from the model-produced JSON object. */
function argument(args: unknown, name: string): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return (args as Record<string, unknown>)[name]
}

/** Reject a URL whose scheme, literal, or complete current DNS set is non-public. */
async function assertPublicUrl(value: string, signal: AbortSignal): Promise<void> {
  let url: URL
  try {
    url = new URL(value)
  } catch (error: unknown) {
    throw new Error('URL argument is invalid', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL argument must use HTTP or HTTPS')
  }
  await resolvePublicAddresses(url.hostname, signal)
}

/** Provider with disposal-aware in-flight DNS validation. */
class McpPolicyProvider implements ToolPolicyProvider {
  private readonly lifetime = new AbortController()
  private readonly active = new Set<Promise<ToolPolicyVerdict | undefined>>()

  constructor(private readonly config: Config) {}

  evaluate(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined> {
    const operation = this.evaluateActive({
      ...request,
      signal: AbortSignal.any([request.signal, this.lifetime.signal]),
    })
    const tracked = operation.finally(() => this.active.delete(tracked))
    this.active.add(tracked)
    return tracked
  }

  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('tool-policy-mcp provider disposed'))
    await Promise.allSettled([...this.active])
  }

  private async evaluateActive(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined> {
    request.signal.throwIfAborted()
    const rule = this.config.rules.find(candidate => candidate.tool === request.toolName)
    if (rule === undefined) return undefined
    if (rule.principals !== undefined) {
      const principal = foldSubagentDescriptor(request.agent.session.snapshotEvents())?.principal
      if (principal === undefined || !rule.principals.includes(principal)) {
        return verdict(this.config.id, 'deny', 100, ['principal'], 'tool call is outside its configured agent role')
      }
    }
    const forbidden = rule.forbiddenArguments.find(name => argument(request.arguments, name) !== undefined)
    if (forbidden !== undefined) {
      return verdict(this.config.id, 'deny', 100, ['forbidden-argument'], 'tool call supplied a deployment-owned argument')
    }
    for (const name of rule.urlArguments) {
      const value = argument(request.arguments, name)
      if (value === undefined) continue
      const values = typeof value === 'string'
        ? [value]
        : Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string')
          ? value
          : undefined
      if (values === undefined) {
        return verdict(this.config.id, 'deny', 100, ['invalid-url'], 'tool call supplied an invalid URL argument')
      }
      try {
        for (const url of values) await assertPublicUrl(url, request.signal)
      } catch (_error: unknown) {
        if (request.signal.aborted) throw request.signal.reason
        return verdict(this.config.id, 'deny', 100, ['blocked-network'], 'tool call targeted a non-public or invalid network destination')
      }
    }
    return verdict(this.config.id, rule.decision, rule.risk, rule.categories, rule.reason)
  }
}

/** Register the MCP provider for the plugin lifetime. */
export function apply(ctx: Context, config: Config): void {
  if (config.id.trim().length === 0) throw new Error('tool-policy-mcp: id must be non-empty')
  if (config.rules.length === 0) throw new Error('tool-policy-mcp: at least one rule is required')
  if (new Set(config.rules.map(rule => rule.tool)).size !== config.rules.length) {
    throw new Error('tool-policy-mcp: rules must use unique tool names')
  }
  for (const rule of config.rules) {
    if (rule.tool.trim().length === 0 || rule.reason.trim().length === 0 || rule.categories.length === 0) {
      throw new Error('tool-policy-mcp: rule tool, reason, and categories must be non-empty')
    }
    if (rule.principals !== undefined && (rule.principals.length === 0
      || rule.principals.some(value => value.trim().length === 0)
      || new Set(rule.principals).size !== rule.principals.length)) {
      throw new Error(`tool-policy-mcp: rule ${JSON.stringify(rule.tool)} principals must be non-empty and unique`)
    }
    const arguments_ = [...rule.urlArguments, ...rule.forbiddenArguments]
    if (arguments_.some(value => value.trim().length === 0) || new Set(arguments_).size !== arguments_.length) {
      throw new Error(`tool-policy-mcp: rule ${JSON.stringify(rule.tool)} argument names must be non-empty and disjoint`)
    }
  }
  const provider = new McpPolicyProvider(config)
  const dispose = ctx.toolPolicy.register(ToolPolicyProviderId(config.id), provider)
  ctx.effect(() => async () => {
    dispose()
    await provider.dispose()
  }, `tool-policy-mcp provider ${config.id}`)
}
