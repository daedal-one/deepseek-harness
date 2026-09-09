/** Provider-routed tool authorization policy. @module @deepseek-ai/dsh-tool-policy */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from './types.ts'
export type * from './types.ts'

/** Stable decision classes understood by enforcement consumers. */
export type ToolPolicyDecision = 'allow' | 'ask' | 'deny'

/** Opaque identity of one registered tool-policy provider. */
export type ToolPolicyProviderId = Branded<'ToolPolicyProviderId'>

/**
 * Brand a validated provider id at a configuration or registration boundary.
 * @param id - stable non-empty provider identifier.
 * @returns the same string with the provider-id brand.
 */
export function ToolPolicyProviderId(id: string): ToolPolicyProviderId {
  return id as ToolPolicyProviderId
}

/** Bounded provider opinion retained for audit without raw arguments. */
export interface ToolPolicyOpinion {
  readonly providerId: ToolPolicyProviderId
  readonly decision: ToolPolicyDecision
  readonly risk: number
  readonly categories: readonly string[]
  readonly reason: string
}

/** Canonical effective verdict returned by the service. */
export interface ToolPolicyVerdict extends ToolPolicyOpinion {
  readonly opinions: readonly ToolPolicyOpinion[]
}

/** Immutable execution facts supplied to a policy provider. */
export interface ToolPolicyRequest {
  readonly callId: ToolCallId
  readonly toolName: string
  readonly arguments: unknown
  readonly agent: Agent
  readonly signal: AbortSignal
}

/** Session facts supplied before an enforced turn is likely to execute a tool. */
export interface ToolPolicyPrewarmRequest {
  readonly session: Session
  readonly signal: AbortSignal
}

/** One implementation of policy for a subset of tools. */
export interface ToolPolicyProvider {
  /** Start optional reusable preparation without delaying the calling session event. */
  prewarm?(request: ToolPolicyPrewarmRequest): Promise<void>
  /** Evaluate a supported tool, or return `undefined` without side effects when unsupported. */
  evaluate(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined>
}

/** Registry routing configuration. */
export interface Config {
  /** Ordered provider ids; omission evaluates every registered provider. */
  readonly providers?: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context { toolPolicy: ToolPolicyService }
}

/** Effect-scoped named policy-provider registry. */
export class ToolPolicyService extends Service {
  static Config: z<Config> = z.object({ providers: z.array(String) })
  private readonly providers = new Map<ToolPolicyProviderId, ToolPolicyProvider>()

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'toolPolicy')
    if (config.providers !== undefined && config.providers.length > 0) {
      if (config.providers.some(id => id.trim().length === 0)) {
        throw new Error('tool-policy: configured provider ids must be non-empty')
      }
      if (new Set(config.providers).size !== config.providers.length) {
        throw new Error('tool-policy: configured provider ids must be unique')
      }
    }
  }

  /**
   * Register one stable provider id.
   * @param id - non-empty deployment-local provider id.
   * @param provider - implementation owned by the registering plugin.
   * @returns idempotent disposer for this exact registration.
   */
  register(id: ToolPolicyProviderId, provider: ToolPolicyProvider): () => void {
    if (id.trim().length === 0) throw new Error('tool-policy: provider id must be non-empty')
    if (this.providers.has(id)) throw new Error(`tool-policy: duplicate provider ${JSON.stringify(id)}`)
    this.providers.set(id, provider)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.providers.get(id) === provider) this.providers.delete(id)
    }
  }

  /**
   * Start reusable preparation in every selected provider that supports it.
   * @param request - session and cancellation for this prewarm opportunity.
   * @returns when every selected provider's preparation has settled.
   */
  async prewarm(request: ToolPolicyPrewarmRequest): Promise<void> {
    await Promise.all(this.selectedProviders().map(provider =>
      provider.prewarm === undefined ? Promise.resolve() : provider.prewarm(request)))
  }

  /**
   * Evaluate one execution through the selected provider.
   * @param request - immutable call identity, arguments, agent, and cancellation.
   * @returns a canonical verdict, or `undefined` when the selected provider does not support the tool.
   * @throws when a configured provider is absent or a selected provider rejects.
   */
  async evaluate(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined> {
    const selected = this.selectedProviders()
    const supported = (await Promise.all(selected.map(provider => provider.evaluate(request))))
      .filter((verdict): verdict is ToolPolicyVerdict => verdict !== undefined)
    if (supported.length === 0) return undefined
    if (supported.length === 1) return supported[0]
    const rank = { allow: 0, ask: 1, deny: 2 } as const
    const effective = supported.reduce((current, verdict) =>
      rank[verdict.decision] > rank[current.decision] ? verdict : current)
    return {
      ...effective,
      providerId: ToolPolicyProviderId('tool-policy'),
      risk: Math.max(...supported.map(verdict => verdict.risk)),
      categories: [...new Set(supported.flatMap(verdict => verdict.categories))],
      reason: `combined policy requires ${effective.decision}`,
      opinions: supported.flatMap(verdict => verdict.opinions.length === 0 ? [verdict] : verdict.opinions),
    }
  }

  private selectedProviders(): ToolPolicyProvider[] {
    if (this.config.providers === undefined || this.config.providers.length === 0) {
      if (this.providers.size === 0) throw new Error('tool-policy: no providers are registered')
      return [...this.providers.values()]
    }
    return this.config.providers.map((id) => {
      const provider = this.providers.get(ToolPolicyProviderId(id))
      if (provider === undefined) {
        throw new Error(`tool-policy: configured provider ${JSON.stringify(id)} is not registered`)
      }
      return provider
    })
  }
}

export default ToolPolicyService
