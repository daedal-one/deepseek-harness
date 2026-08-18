/**
 * OpenRouter web search through Chat Completions and the
 * `openrouter:web_search` server tool. The auxiliary answer and standardized
 * URL citations become the provider-neutral web result.
 * @module @deepseek-ai/dsh-web-search-openrouter/provider
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { OpenRouterError, OpenRouterSearchResponse, OpenRouterUrlCitation } from './types.ts'

/** Stable id this provider registers under. */
export const OPENROUTER_PROVIDER_ID = 'openrouter'

/** Default OpenRouter API endpoint; `/chat/completions` is appended. */
export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

/** Default auxiliary model delegates model selection to OpenRouter. */
export const OPENROUTER_DEFAULT_MODEL = 'openrouter/auto'

/** Default search engine lets OpenRouter prefer native search and fall back. */
export const OPENROUTER_DEFAULT_ENGINE = 'auto'

/** Default upper bound on generated answer tokens. */
export const OPENROUTER_DEFAULT_MAX_TOKENS = 4096

/** Default maximum server-tool searches within one auxiliary request. */
export const OPENROUTER_DEFAULT_MAX_USES = 5

/** Search engines accepted by OpenRouter's current server-tool API. */
export type OpenRouterSearchEngine = 'auto' | 'native' | 'exa' | 'firecrawl' | 'parallel' | 'perplexity'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Exact secret-free request recorded before one auxiliary search dispatch. */
export interface OpenRouterSearchLlmRequest {
  /** Fully resolved Chat Completions endpoint. */
  readonly endpoint: string
  /** Exact JSON body sent to OpenRouter. */
  readonly body: {
    readonly model: string
    readonly max_tokens: number
    readonly messages: readonly [{
      readonly role: 'user'
      readonly content: string
    }]
    readonly tools: readonly [{
      readonly type: 'openrouter:web_search'
      readonly parameters: {
        readonly engine: OpenRouterSearchEngine
        readonly max_results?: number
        readonly max_total_results?: number
        readonly max_uses: number
      }
    }]
    readonly max_tool_calls: number
    readonly provider: {
      readonly data_collection: 'deny'
    }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary OpenRouter search request recorded before dispatch. */
    'web/openrouter-search-llm-request': OpenRouterSearchLlmRequest
  }
}

/** Resolved provider options snapshotted for each search operation. */
export interface OpenRouterSearchProviderOptions {
  /** Literal OpenRouter API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current OpenRouter API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/chat/completions` is appended. */
  baseURL: string
  /** Auxiliary OpenRouter model id. */
  model: string
  /** OpenRouter search-engine selection. */
  engine: OpenRouterSearchEngine
  /** Upper bound on generated answer tokens. */
  maxTokens: number
  /** Maximum server-tool searches within one auxiliary request. */
  maxUses: number
  /**
   * Record the exact secret-free request before dispatch. A throw prevents the
   * request so model-visible auxiliary input cannot escape logging.
   */
  recordRequest?: (request: OpenRouterSearchLlmRequest) => void
}

/**
 * Map one standardized citation to a normalized source.
 * @param annotation - one assistant-message annotation.
 * @returns the normalized source, or `undefined` for a non-citation or blank URL.
 */
export function mapOpenRouterCitation(annotation: OpenRouterUrlCitation): WebSearchSource | undefined {
  if (annotation.type !== 'url_citation') return undefined
  const citation = annotation.url_citation
  if (citation?.url == null || citation.url.length === 0) return undefined
  return {
    url: citation.url,
    ...citation.title != null && citation.title.length > 0 ? { title: citation.title } : {},
    ...citation.content != null && citation.content.length > 0 ? { snippet: citation.content } : {},
  }
}

/**
 * Map an OpenRouter response to the provider-neutral result.
 * @param response - parsed Chat Completions response.
 * @returns the auxiliary answer and deduplicated URL citations.
 * @throws {@link WebError} when OpenRouter returned no citeable search result.
 */
export function mapOpenRouterResponse(response: OpenRouterSearchResponse): WebSearchResult {
  const message = response.choices?.[0]?.message
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const annotation of message?.annotations ?? []) {
    const source = mapOpenRouterCitation(annotation)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  if (sources.length === 0) {
    throw new WebError(
      'OpenRouter returned no URL citations; the auxiliary model may not have used web search',
      'WEB_PROVIDER_ERROR',
    )
  }
  const content = message?.content
  return {
    ...content != null && content.length > 0 ? { content } : {},
    sources,
    truncated: false,
  }
}

/** The OpenRouter-backed search provider; HTTP redirects fail. */
export class OpenRouterSearchProvider implements WebSearchProvider {
  readonly id = OPENROUTER_PROVIDER_ID

  /**
   * @param resolveOptions - options for the next operation, snapshotted once at
   * operation entry so a search never mixes settings revisions.
   */
  constructor(private readonly resolveOptions: () => OpenRouterSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.model.length > 0
      && isPositiveInteger(options.maxTokens)
      && isPositiveInteger(options.maxUses)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const endpoint = `${options.baseURL.replace(/\/$/u, '')}/chat/completions`
    const resultLimit = request.maxResults
    const body: OpenRouterSearchLlmRequest['body'] = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{
        role: 'user',
        content: `Use web search to answer this query with cited sources: ${request.query}`,
      }],
      tools: [{
        type: 'openrouter:web_search',
        parameters: {
          engine: options.engine,
          ...resultLimit === undefined ? {} : {
            max_results: resultLimit,
            max_total_results: resultLimit,
          },
          max_uses: options.maxUses,
        },
      }],
      max_tool_calls: options.maxUses,
      provider: { data_collection: 'deny' },
    }
    options.recordRequest?.({ endpoint, body })
    throwIfSearchAborted(signal)

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`OpenRouter search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      let message = `OpenRouter API error (HTTP ${response.status})`
      try {
        const parsed = await response.json() as OpenRouterError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
        // The HTTP status already preserves the failure when the body is not JSON.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      return mapOpenRouterResponse(await response.json() as OpenRouterSearchResponse)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`OpenRouter returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async apiKey(options: OpenRouterSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `OpenRouter search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'OPENROUTER_API_KEY'
    throw new WebError(
      `OpenRouter search has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Models page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-openrouter config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/** Race an asynchronous preflight against caller cancellation. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error after caller abort. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error with the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('OpenRouter search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for positive whole-number OpenRouter request limits. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
