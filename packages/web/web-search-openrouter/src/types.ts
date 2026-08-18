/**
 * Provider-private wire types for OpenRouter Chat Completions with the
 * `openrouter:web_search` server tool. These types do not depend on `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-openrouter/types
 */

/** One standardized OpenRouter URL citation. */
export interface OpenRouterUrlCitation {
  type?: string
  url_citation?: {
    url?: string | null
    title?: string | null
    content?: string | null
  }
}

/** The assistant message returned after OpenRouter finishes server-tool use. */
export interface OpenRouterSearchMessage {
  content?: string | null
  annotations?: OpenRouterUrlCitation[]
}

/** OpenRouter Chat Completions response fields consumed by the provider. */
export interface OpenRouterSearchResponse {
  choices?: Array<{
    message?: OpenRouterSearchMessage
  }>
}

/** OpenRouter error response envelope. */
export interface OpenRouterError {
  error?: { message?: string } | string
  message?: string
}
