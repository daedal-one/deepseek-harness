import { describe, expect, it } from 'vitest'
import {
  OpenRouterSearchProvider,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_ENGINE,
  OPENROUTER_DEFAULT_MAX_TOKENS,
  OPENROUTER_DEFAULT_MAX_USES,
  OPENROUTER_DEFAULT_MODEL,
} from '@deepseek-ai/dsh-web-search-openrouter'

/** Construct the provider over a fixed options value; production passes a live thunk. */
import type { OpenRouterSearchProviderOptions } from '@deepseek-ai/dsh-web-search-openrouter'

const searchProvider = (options: OpenRouterSearchProviderOptions): OpenRouterSearchProvider =>
  new OpenRouterSearchProvider(() => options)

/**
 * Real-API probe for the current OpenRouter server-tool request and citation
 * response. It self-skips when no OpenRouter credential is available.
 */
const apiKey = process.env.OPENROUTER_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('OpenRouterSearchProvider real API', () => {
  it('returns citeable sources for a live query', async () => {
    const provider = searchProvider({
      apiKey: apiKey!,
      baseURL: process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL,
      model: process.env.OPENROUTER_SEARCH_MODEL ?? OPENROUTER_DEFAULT_MODEL,
      engine: OPENROUTER_DEFAULT_ENGINE,
      maxTokens: OPENROUTER_DEFAULT_MAX_TOKENS,
      maxUses: Math.min(OPENROUTER_DEFAULT_MAX_USES, 2),
    })
    const result = await provider.search({ query: 'What is OpenRouter Harness?', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 60_000)
})
