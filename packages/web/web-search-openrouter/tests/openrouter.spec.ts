import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  OpenRouterSearchProvider,
  OPENROUTER_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-openrouter'
import type { OpenRouterSearchProviderOptions } from '@deepseek-ai/dsh-web-search-openrouter'
import * as openrouterPlugin from '@deepseek-ai/dsh-web-search-openrouter'
import { mapOpenRouterCitation, mapOpenRouterResponse } from '../src/provider.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const searchProvider = (options: OpenRouterSearchProviderOptions): OpenRouterSearchProvider =>
  new OpenRouterSearchProvider(() => options)

const options: OpenRouterSearchProviderOptions = {
  apiKey: 'or-key',
  baseURL: 'https://openrouter.test/api/v1',
  model: 'openrouter/auto',
  engine: 'auto',
  maxTokens: 4096,
  maxUses: 5,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function searchResponse(): object {
  return {
    choices: [{
      message: {
        content: 'Found two sources.',
        annotations: [
          {
            type: 'url_citation',
            url_citation: { url: 'https://a.test', title: 'A', content: 'Excerpt A' },
          },
          {
            type: 'url_citation',
            url_citation: { url: 'https://b.test', title: 'B' },
          },
        ],
      },
    }],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenRouter response mapping', () => {
  it('maps standardized URL citations and the auxiliary answer', () => {
    expect(mapOpenRouterResponse(searchResponse())).toEqual({
      content: 'Found two sources.',
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'Excerpt A' },
        { url: 'https://b.test', title: 'B' },
      ],
      truncated: false,
    })
  })

  it('deduplicates URLs, omits blank optional fields, and omits blank answer text', () => {
    expect(mapOpenRouterResponse({
      choices: [{
        message: {
          content: '',
          annotations: [
            { type: 'url_citation', url_citation: { url: 'https://a.test', title: '', content: '' } },
            { type: 'url_citation', url_citation: { url: 'https://a.test', title: 'duplicate' } },
          ],
        },
      }],
    })).toEqual({ sources: [{ url: 'https://a.test' }], truncated: false })
  })

  it('ignores non-citations and citations without a URL', () => {
    expect(mapOpenRouterCitation({ type: 'other' })).toBeUndefined()
    expect(mapOpenRouterCitation({ type: 'url_citation' })).toBeUndefined()
    expect(mapOpenRouterCitation({ type: 'url_citation', url_citation: { url: '' } })).toBeUndefined()
  })

  it('fails when the response contains no citeable search result', () => {
    expect(() => mapOpenRouterResponse({ choices: [{ message: { content: 'uncited' } }] }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(() => mapOpenRouterResponse({}))
      .toThrow('OpenRouter returned no URL citations')
  })
})

describe('OpenRouterSearchProvider availability', () => {
  it('requires a credential source, valid endpoint, model, and positive limits', () => {
    expect(searchProvider(options).available()).toBe(true)
    expect(searchProvider({ ...options, apiKey: '', resolveApiKey: async () => 'key' }).available()).toBe(true)
    expect(searchProvider({ ...options, apiKey: '' }).available()).toBe(false)
    expect(searchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
    expect(searchProvider({ ...options, model: '' }).available()).toBe(false)
    expect(searchProvider({ ...options, maxTokens: 0 }).available()).toBe(false)
    expect(searchProvider({ ...options, maxUses: 0 }).available()).toBe(false)
    expect(searchProvider({ ...options, maxUses: 1.5 }).available()).toBe(false)
  })
})

describe('OpenRouterSearchProvider request mapping', () => {
  it('records and posts the exact server-tool request with privacy and result bounds', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(searchResponse()))
    const recordRequest = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await searchProvider({ ...options, baseURL: `${options.baseURL}/`, recordRequest })
      .search({ query: 'hello', maxResults: 3 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.test/api/v1/chat/completions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer or-key')
    const body = {
      model: 'openrouter/auto',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'Use web search to answer this query with cited sources: hello' }],
      tools: [{
        type: 'openrouter:web_search',
        parameters: {
          engine: 'auto',
          max_results: 3,
          max_total_results: 3,
          max_uses: 5,
        },
      }],
      max_tool_calls: 5,
      provider: { data_collection: 'deny' },
    }
    expect(JSON.parse(init.body as string)).toEqual(body)
    expect(recordRequest).toHaveBeenCalledWith({ endpoint: url, body })
    expect(recordRequest.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? 0)
  })

  it('omits result controls when the caller supplies no bound and forwards cancellation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await searchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
    expect(JSON.parse(init.body as string)).toMatchObject({
      tools: [{ parameters: { engine: 'auto', max_uses: 5 } }],
    })
  })

  it('prevents dispatch when durable request logging fails', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchProvider({
      ...options,
      recordRequest: () => { throw new Error('log unavailable') },
    }).search({ query: 'q' })).rejects.toThrow('log unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses one settings snapshot across asynchronous credential resolution', async () => {
    const before = { ...options, apiKey: '', baseURL: 'https://before.test/v1', model: 'model-before' }
    const after = { ...options, apiKey: '', baseURL: 'https://after.test/v1', model: 'model-after' }
    let current = before
    let commit: (() => void) | undefined
    const resolveApiKey = () => new Promise<string>((resolve) => {
      commit = () => { current = after; resolve('before-key') }
    })
    const fetchMock = vi.fn(async () => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const pending = new OpenRouterSearchProvider(() => ({ ...current, resolveApiKey })).search({ query: 'q' })
    await vi.waitFor(() => { expect(commit).toBeTypeOf('function') })
    commit?.()
    await pending
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(endpoint).toBe('https://before.test/v1/chat/completions')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer before-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'model-before' })
  })
})

describe('OpenRouterSearchProvider failure handling', () => {
  it('does not resolve credentials or dispatch after a pre-abort', async () => {
    const resolveApiKey = vi.fn(async () => 'key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(searchProvider({ ...options, apiKey: '', resolveApiKey })
      .search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts an uncooperative credential resolver', async () => {
    const controller = new AbortController()
    const pending = searchProvider({
      ...options,
      apiKey: '',
      resolveApiKey: () => new Promise<string>(() => {}),
    }).search({ query: 'q' }, controller.signal)
    controller.abort(new Error('deadline'))
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('uses resolved credentials and reports resolver failures', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await searchProvider({ ...options, apiKey: '', resolveApiKey: async () => 'resolved' }).search({ query: 'q' })
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)['authorization']).toBe('Bearer resolved')
    await expect(searchProvider({
      ...options,
      apiKey: '',
      resolveApiKey: () => Promise.reject(new Error('credential failed')),
    }).search({ query: 'q' }))
      .rejects.toThrow('OpenRouter search credential resolution failed: Error: credential failed')
  })

  it('reports the default credential reference when no key resolves', async () => {
    await expect(searchProvider({ ...options, apiKey: '' }).search({ query: 'q' }))
      .rejects.toThrow('OpenRouter search has no API key for "OPENROUTER_API_KEY"')
  })

  it('observes cancellation triggered during credential resolution', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchProvider({
      ...options,
      apiKey: '',
      resolveApiKey: () => {
        controller.abort(new Error('cancelled'))
        return Promise.resolve('unused')
      },
    }).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves provider error details and HTTP fallback messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, { status: 429 })))
    await expect(searchProvider(options).search({ query: 'q' })).rejects.toThrow('rate limited')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad request' }, { status: 400 })))
    await expect(searchProvider(options).search({ query: 'q' })).rejects.toThrow('bad request')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'gateway detail' }, { status: 502 })))
    await expect(searchProvider(options).search({ query: 'q' })).rejects.toThrow('gateway detail')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 503 })))
    await expect(searchProvider(options).search({ query: 'q' })).rejects.toThrow('OpenRouter API error (HTTP 503)')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(searchProvider(options).search({ query: 'q' })).rejects.toThrow('OpenRouter API error (HTTP 500)')
  })

  it('classifies network, fetch-abort, custom-abort, and body failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    await expect(searchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(searchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))

    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('custom')) }, { once: true })
      })))
    const pending = searchProvider(options).search({ query: 'q' }, controller.signal)
    controller.abort(new Error('timeout'))
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(searchProvider(options).search({ query: 'q' }))
      .rejects.toThrow('OpenRouter returned an unprocessable response body')
  })

  it('classifies aborts while parsing success and error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    }) as Response))
    await expect(searchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    }) as Response))
    await expect(searchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-openrouter plugin', () => {
  it('registers and disposes through ctx.web', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(searchResponse())))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    const fiber = await ctx.plugin(openrouterPlugin, { apiKey: 'or-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('rejects invalid limits and engines at load', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    await expect(ctx.plugin(openrouterPlugin, { apiKey: 'or-key', maxTokens: 0 }))
      .rejects.toThrow(/maxTokens expected number >= 1/)
    await expect(ctx.plugin(openrouterPlugin, { apiKey: 'or-key', maxUses: 0 }))
      .rejects.toThrow(/maxUses expected number >= 1/)
    await expect(ctx.plugin(openrouterPlugin, { apiKey: 'or-key', maxUses: 1.5 }))
      .rejects.toThrow(/maxUses expected number multiple of 1/)
    await expect(ctx.plugin(openrouterPlugin, { apiKey: 'or-key', engine: 'unknown' as 'auto' }))
      .rejects.toThrow(/engine expected/)
  })

  it('keeps the namespace export shape through Loader', async () => {
    expect('default' in openrouterPlugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(openrouterPlugin) as typeof openrouterPlugin
    expect(unwrapped.name).toBe('web-search-openrouter')
    expect(unwrapped.inject).toEqual(['web'])
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    const fiber = await ctx.plugin(unwrapped, { apiKey: 'or-key' })
    await fiber.dispose()
  })

  it('uses shared OpenRouter environment defaults', async () => {
    const previousKey = process.env.OPENROUTER_API_KEY
    const previousBase = process.env.OPENROUTER_BASE_URL
    process.env.OPENROUTER_API_KEY = 'env-key'
    process.env.OPENROUTER_BASE_URL = 'https://gateway.test/v1'
    try {
      const fetchMock = vi.fn(async () => jsonResponse(searchResponse()))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
      openrouterPlugin.apply(ctx, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://gateway.test/v1/chat/completions')
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      expect(JSON.parse(init.body as string)).toMatchObject({
        model: 'openrouter/auto',
        tools: [{ parameters: { engine: 'auto' } }],
      })
      await ctx.fiber.dispose()
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = previousKey
      if (previousBase === undefined) delete process.env.OPENROUTER_BASE_URL
      else process.env.OPENROUTER_BASE_URL = previousBase
    }
  })

  it('resolves a stored or rotated key for every search', async () => {
    const previous = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-openrouter-search-'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(openrouterPlugin, { baseURL: 'https://openrouter.test/v1' })
      await expect(ctx.web.search({ query: 'missing' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
      const ref = credentialRef('OPENROUTER_API_KEY')
      await ctx.credentials.set(ref, 'stored')
      await ctx.web.search({ query: 'stored' })
      await ctx.credentials.set(ref, 'rotated')
      await ctx.web.search({ query: 'rotated' })
      expect(fetchMock.mock.calls.map(([, init]) =>
        ((init as RequestInit).headers as Record<string, string>)['authorization']))
        .toEqual(['Bearer stored', 'Bearer rotated'])
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = previous
    }
  })
})
