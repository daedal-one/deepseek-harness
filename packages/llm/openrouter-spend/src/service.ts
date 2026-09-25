/**
 * Remote-only service answering, for the Web UI: what the configured
 * OpenRouter inference key's spend looks like, and what this session's
 * estimated USD cost is.
 * @module @deepseek-ai/dsh-openrouter-spend/service
 */

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
// Type-only: supplies the `tokenUsage` projection declaration.
import type {} from '@deepseek-ai/dsh-token-meter'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { findModelPricing } from './api.ts'
import { TtlCache } from './cache.ts'
import { sessionCostUsd, type OpenRouterTokenBuckets } from './pricing.ts'
import { readKeyUsage, readModels, type OpenRouterKeyReadResult, type OpenRouterModelsReadResult, type OpenRouterReadOptions } from './openrouter.ts'
import type {
  OpenRouterSpendReadRequest,
  OpenRouterSpendReadResult,
  OpenRouterSessionSpend,
} from './types.ts'

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
 * One cached reading of OpenRouter. The key usage and the model catalog are
 * two independent cached facts, each shared across concurrent reads.
 */
export class OpenRouterSpendService extends TypertRemoteService {
  static inject = ['sessions', 'sessionProjections']
  static Config = Config

  private readonly config: Config
  private readonly keyCache: TtlCache<OpenRouterKeyReadResult>
  private readonly catalogCache: TtlCache<OpenRouterModelsReadResult>

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
    const options: OpenRouterReadOptions = {
      baseURL: this.config.baseURL,
      apiKey,
      requestTimeoutMs: this.config.requestTimeoutMs,
    }
    const keyResult = await this.keyCache.read(() => readKeyUsage(options, SHARED_READ_SIGNAL))
    if (!keyResult.ok) return { ok: false, error: keyResult.error }
    const session = await this.sessionSpend(request.sessionId, options)
    return { ok: true, value: { key: keyResult.value, session, fetchedAt: Date.now() } }
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
   * Price one live session best-effort: a missing selection, a failed catalog
   * read, or an unknown model degrades the estimate to null, never a failure.
   * @param sessionId - the session to price.
   * @param options - the endpoint base, key, and request bound for the catalog read.
   * @returns the session estimate, or null when there is nothing to report.
   */
  private async sessionSpend(
    sessionId: SessionId,
    options: OpenRouterReadOptions,
  ): Promise<OpenRouterSessionSpend | null> {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return null
    const snapshot = this.ctx.sessionProjections.snapshot(session, ['modelSelection', 'tokenUsage'])
    const selection = snapshot.values.modelSelection
    const selected = selection === undefined ? null : selection.next ?? selection.lastUsed
    if (selected === null) return null
    const tokenUsage = snapshot.values.tokenUsage
    const spend: OpenRouterSessionSpend = {
      provider: selected.provider,
      model: selected.model,
      costUsd: tokenUsage === undefined ? null : await this.priceSession(selected.model, tokenUsage, options),
    }
    return spend
  }

  /**
   * Look up the model's catalog prices and price the session's token buckets.
   * @param model - the exact model id to look up.
   * @param tokenUsage - the durable whole-log token buckets to price.
   * @param options - the endpoint base, key, and request bound for the catalog read.
   * @returns the exact USD cost, or null when the cost is unpriceable.
   */
  private async priceSession(
    model: string,
    tokenUsage: OpenRouterTokenBuckets,
    options: OpenRouterReadOptions,
  ): Promise<number | null> {
    const catalog = await this.catalogCache.read(() => readModels(options, SHARED_READ_SIGNAL))
    if (!catalog.ok) return null
    const pricing = findModelPricing(catalog.value, model)
    if (pricing === undefined) return null
    return sessionCostUsd(tokenUsage, pricing)
  }
}

export default OpenRouterSpendService
