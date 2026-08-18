/**
 * Register an OpenRouter-backed provider in `ctx.web`. It uses Chat
 * Completions with the `openrouter:web_search` server tool and reuses the
 * conversation route's `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` settings.
 * @module @deepseek-ai/dsh-web-search-openrouter
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import {
  OpenRouterSearchProvider,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_ENGINE,
  OPENROUTER_DEFAULT_MAX_TOKENS,
  OPENROUTER_DEFAULT_MAX_USES,
  OPENROUTER_DEFAULT_MODEL,
} from './provider.ts'
import type { OpenRouterSearchEngine, OpenRouterSearchProviderOptions } from './provider.ts'

export {
  OpenRouterSearchProvider,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_ENGINE,
  OPENROUTER_DEFAULT_MAX_TOKENS,
  OPENROUTER_DEFAULT_MAX_USES,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
} from './provider.ts'
export type {
  OpenRouterSearchEngine,
  OpenRouterSearchLlmRequest,
  OpenRouterSearchProviderOptions,
} from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-openrouter'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'OPENROUTER_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal OpenRouter API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `OPENROUTER_API_KEY`. */
  apiKeyEnv?: string
  /** OpenRouter endpoint base; `/chat/completions` is appended. */
  baseURL?: string
  /** Auxiliary model id. Defaults to `openrouter/auto`. */
  model?: string
  /** Search engine. Defaults to `auto`. */
  engine?: OpenRouterSearchEngine
  /** Upper bound on generated answer tokens. Defaults to 4096. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  model: z.string().default(OPENROUTER_DEFAULT_MODEL),
  engine: z.union(['auto', 'native', 'exa', 'firecrawl', 'parallel', 'perplexity'] as const)
    .default(OPENROUTER_DEFAULT_ENGINE),
  maxTokens: z.number().step(1).min(1).default(OPENROUTER_DEFAULT_MAX_TOKENS),
  maxUses: z.number().step(1).min(1).default(OPENROUTER_DEFAULT_MAX_USES),
})

/**
 * The search provider shares the OpenRouter endpoint override with conversation
 * traffic; a deployment proxy therefore needs one base URL setting.
 */
const SEARCH_BASE_URL_ENV = 'OPENROUTER_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_OPENROUTER_SETTINGS_NAMESPACE = 'web-search-openrouter'

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): OpenRouterSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
      ?? OPENROUTER_DEFAULT_BASE_URL,
    model: config.model ?? OPENROUTER_DEFAULT_MODEL,
    engine: config.engine ?? OPENROUTER_DEFAULT_ENGINE,
    maxTokens: config.maxTokens ?? OPENROUTER_DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? OPENROUTER_DEFAULT_MAX_USES,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/openrouter-search-llm-request',
        request,
      )
    },
  }
}

/** Register the OpenRouter search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_OPENROUTER_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      // The registration carries no resolved value: the provider projects the
      // section per search, so a committed change needs no re-registration.
      onChange: () => {},
    })
  })
  ctx.web.registerSearchProvider(new OpenRouterSearchProvider(() => resolveOptions(ctx, current())))
}
