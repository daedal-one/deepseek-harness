/**
 * The docs-search Service Definition is a pure contract: it must register as
 * `ctx.docsSearch`, refuse to load as an abstract service, and export the
 * vocabulary a provider and a consumer share.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import DocsSearcher from '../src/index.ts'

describe('docs-search Service Definition', () => {
  it('refuses to mount the abstract service', async () => {
    const ctx = new Context()
    try {
      const RuntimeDefinition = DocsSearcher as unknown as new (ctx: Context) => DocsSearcher
      await expect(ctx.plugin(RuntimeDefinition)).rejects.toThrow(/abstract docs-search seam/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('registers a concrete subclass under ctx.docsSearch', async () => {
    class StubSearcher extends DocsSearcher {
      override async search(): Promise<never[]> {
        return []
      }

      override status(): { chunks: number; indexed: number; modelReady: boolean; building: boolean } {
        return { chunks: 0, indexed: 0, modelReady: false, building: false }
      }

      override reindex(): Record<string, never> {
        return {}
      }
    }
    const ctx = new Context()
    try {
      await ctx.plugin(StubSearcher)
      expect(await ctx.docsSearch.search({ query: 'anything' })).toEqual([])
      expect(ctx.docsSearch.status()).toEqual({ chunks: 0, indexed: 0, modelReady: false, building: false })
      expect(ctx.docsSearch.reindex()).toEqual({})
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
