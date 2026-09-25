/**
 * Remote-only service answering, for the Web UI: what the configured
 * OpenRouter inference key's spend looks like, and what this session's
 * estimated USD cost is.
 * @module @deepseek-ai/dsh-openrouter-spend/service
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: declares `ctx.sessions` on the Cordis Context.
import type {} from '@deepseek-ai/dsh-session'
// Type-only: declares `ctx.sessionProjections` on the Cordis Context.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: supplies the `modelSelection` projection declaration.
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { findModelPricing } from './api.ts'
import { TtlCache } from './cache.ts'
import { attributedSessionUsage, sessionCostUsd, type AttributedSessionUsage } from './pricing.ts'
import { readKeyUsage, readModels, type OpenRouterKeyReadResult, type OpenRouterModelsReadResult, type OpenRouterReadOptions } from './openrouter.ts'
import type {
  OpenRouterSpendReadRequest,
  OpenRouterSpendReadResult,
  OpenRouterSessionSpend,
} from './types.ts'

/** Provider identity used by OpenRouter's installed LLM route. */
const OPENROUTER_PROVIDER = 'openrouter'

/**
 * Service configuration, fully resolved by the schema's defaults before the
 * service reads any field.
 */
export interface Config {
  /** Credential reference resolved for each key read. */
  readonly credentialRef: string
  /** OpenRouter endpoint base; `/key` and `/models` are appended. */
  readonly baseURL: string
  /** Lifetime of one cached OpenRouter reading, in milliseconds. */
  readonly cacheTtlMs: number
  /** Upper bound on one OpenRouter request, in milliseconds. */
  readonly requestTimeoutMs: number
}

/**
 * Loader validation and the explicit default-resolution step for the service
 * configuration; the service itself never re-applies defaults at runtime.
 */
export const Config: s<Config> = s.object({
  credentialRef: s.string().role('credential-ref').default('OPENROUTER_API_KEY'),
  baseURL: s.string().default('https://openrouter.ai/api/v1'),
  cacheTtlMs: s.number().step(1).min(0).default(60000),
  requestTimeoutMs: s.number().step(1).min(1).default(10000),
})

/**
 * Signal handed to a cached OpenRouter read. One cached load is shared by every
 * concurrent caller, so it must not inherit any single caller's cancellation:
 * a client that refreshes mid-flight would otherwise abort the shared request
 * and each sharer would report a spurious unreachable failure. The request
 * keeps its own timeout, and an abandoned load only populates the cache.
 */
const SHARED_READ_SIGNAL = new AbortController().signal

/**
 * Create an in-memory identity for one credential without retaining or exposing
 * the credential itself.
 * @param apiKey - credential used only to authenticate the key endpoint.
 * @returns non-secret fingerprint used solely for cache invalidation.
 */
function credentialFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

/**
 * One cached reading of OpenRouter. The key usage and the model catalog are
 * two independent cached facts, each shared across concurrent reads.
 */
export class OpenRouterSpendService extends TypertRemoteService {
  static inject = ['sessions', 'sessionProjections']
  static Config = Config

  private readonly config: Config
  private readonly keyCache: TtlCache<OpenRouterKeyReadResult>
  private readonly catalogCache: TtlCache<OpenRouterModelsReadResult>
  private keyCacheCredential: string | undefined

  /**
   * @param ctx - Host context carrying live sessions and the projection registry.
   * @param config - the schema-resolved service configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'openrouterSpend')
    this.config = config
    this.keyCache = new TtlCache(config.cacheTtlMs)
    this.catalogCache = new TtlCache(config.cacheTtlMs)
  }

  /**
   * Read the configured key's spend and the request session's estimated cost.
   * @param request - the session to price.
   * @param signal - carrier cancellation; an already-cancelled call reads nothing.
   * @returns the key usage plus the session estimate, or an explicit failure for the key read.
   */
  @Remote('read')
  async read(request: OpenRouterSpendReadRequest, signal: AbortSignal): Promise<OpenRouterSpendReadResult> {
    if (signal.aborted) {
      return { ok: false, error: { reason: 'unreachable', detail: 'request aborted before OpenRouter answered' } }
    }
    const apiKey = await this.resolveApiKey()
    if (apiKey === undefined) {
      return {
        ok: false,
        error: {
          reason: 'not-configured',
          detail: `no OpenRouter API key is available under "${this.config.credentialRef}"; `
            + 'store it through the credentials service or export it in the launching environment',
        },
      }
    }
    this.invalidateKeyCacheFor(apiKey)
    const options: OpenRouterReadOptions = {
      baseURL: this.config.baseURL,
      apiKey,
      requestTimeoutMs: this.config.requestTimeoutMs,
    }
    const keyResult = await this.keyCache.read(
      () => readKeyUsage(options, SHARED_READ_SIGNAL),
      result => result.ok,
    )
    if (!keyResult.value.ok) return { ok: false, error: keyResult.value.error }
    const session = await this.sessionSpend(request.sessionId, options)
    return { ok: true, value: { key: keyResult.value.value, session, fetchedAt: keyResult.fetchedAt } }
  }

  /**
   * Resolve the current OpenRouter inference key for one read.
   * @returns the key value, or undefined when no layer supplies a non-empty value.
   */
  private async resolveApiKey(): Promise<string | undefined> {
    const ref = credentialRef(this.config.credentialRef)
    const credentials = this.ctx.get('credentials')
    const apiKey = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(this.ctx).get(ref)?.value
    return apiKey !== undefined && apiKey.length > 0 ? apiKey : undefined
  }

  /**
   * Invalidate cached key usage when a different configured credential becomes active.
   * @param apiKey - current credential, never retained after its fingerprint is computed.
   */
  private invalidateKeyCacheFor(apiKey: string): void {
    const fingerprint = credentialFingerprint(apiKey)
    if (fingerprint === this.keyCacheCredential) return
    this.keyCacheCredential = fingerprint
    this.keyCache.clear()
  }

  /**
   * Price one live session best-effort. The display route remains the current
   * durable selection, while every settled usage is priced from its own durable
   * request attribution so a pending next selection cannot reprice history.
   * @param sessionId - the session to price.
   * @param options - the endpoint base and request bound for the public catalog read.
   * @returns the session estimate, or null when there is nothing to report.
   */
  private async sessionSpend(
    sessionId: SessionId,
    options: OpenRouterReadOptions,
  ): Promise<OpenRouterSessionSpend | null> {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return null
    const snapshot = this.ctx.sessionProjections.snapshot(session, ['modelSelection'])
    const selection = snapshot.values.modelSelection
    const selected = selection === undefined ? null : selection.lastUsed ?? selection.next
    if (selected === null) return null
    return {
      provider: selected.provider,
      model: selected.model,
      costUsd: await this.priceSession(attributedSessionUsage(session.snapshotEvents()), options),
    }
  }

  /**
   * Price each settled usage at its own routed OpenRouter model. A route lacking
   * durable attribution, a non-OpenRouter route, or any absent price leaves the
   * full historical cost explicitly unpriceable.
   * @param usages - route-attributed settled usage, or null when attribution is incomplete.
   * @param options - the endpoint base and request bound for the public catalog read.
   * @returns exact total USD cost, or null when the cost is unpriceable.
   */
  private async priceSession(
    usages: readonly AttributedSessionUsage[] | null,
    options: OpenRouterReadOptions,
  ): Promise<number | null> {
    if (usages === null || usages.some(usage => usage.provider !== OPENROUTER_PROVIDER)) return null
    if (usages.length === 0) return 0

    const catalog = await this.catalogCache.read(
      () => readModels({ baseURL: options.baseURL, requestTimeoutMs: options.requestTimeoutMs }, SHARED_READ_SIGNAL),
      result => result.ok,
    )
    if (!catalog.value.ok) return null

    let total = 0
    for (const usage of usages) {
      const pricing = findModelPricing(catalog.value.value, usage.model)
      if (pricing === undefined) return null
      const cost = sessionCostUsd(usage.buckets, pricing)
      if (cost === null) return null
      total += cost
      if (!Number.isFinite(total)) return null
    }
    return total
  }
}

export default OpenRouterSpendService
