import { afterEach, describe, expect, it, vi } from 'vitest'
import { readModels } from '../src/read.ts'
import type { OpenRouterReadOptions } from '../src/types.ts'

const options: OpenRouterReadOptions = {
  baseURL: 'https://openrouter.test/api/v1',
  apiKey: 'sk-or-v1-secret-key-000',
  requestTimeoutMs: 10_000,
}

const MODELS_BODY = {
  data: [{ id: 'a/b', pricing: { prompt: '0.000001', completion: '0.000002' } }],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type FetchImplementation = (
  input: URL | RequestInfo | XMLHttpRequestBodyInit,
  init?: RequestInit,
) => Response | Promise<Response>

function stubFetch(implementation: FetchImplementation) {
  const impl = vi.fn(implementation)
  vi.stubGlobal('fetch', impl)
  return impl
}

function lastFetchCall(fetchSpy: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [input, init] = fetchSpy.mock.calls.at(-1) as [URL | string, RequestInit]
  return { url: String(input), init: init ?? {} }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readModels', () => {
  it('GETs the public /models endpoint without sending a credential', async () => {
    const fetchSpy = stubFetch(() => jsonResponse(MODELS_BODY))
    const result = await readModels(options, new AbortController().signal)

    expect(result).toEqual({
      ok: true,
      value: [{ id: 'a/b', pricing: { prompt: '0.000001', completion: '0.000002', cacheRead: null, cacheWrite: null } }],
    })
    const { url, init } = lastFetchCall(fetchSpy)
    expect(url).toBe('https://openrouter.test/api/v1/models')
    const headers = init.headers as Record<string, string>
    expect(headers['user-agent']).toBe('deepseek-harness/0.1.5-alpha.2')
    expect(headers['authorization']).toBeUndefined()
  })

  it('trims a trailing slash from the endpoint base', async () => {
    const fetchSpy = stubFetch(() => jsonResponse(MODELS_BODY))
    await readModels({ ...options, baseURL: 'https://openrouter.test/api/v1/' }, new AbortController().signal)

    expect(lastFetchCall(fetchSpy).url).toBe('https://openrouter.test/api/v1/models')
  })

  it('maps a malformed models body to malformed-response', async () => {
    stubFetch(() => jsonResponse({ data: 'nope' }))
    const result = await readModels(options, new AbortController().signal)

    expect(result).toMatchObject({ ok: false, error: { reason: 'malformed-response', detail: '"data" must be an array' } })
  })

  it('maps a non-2xx status to unreachable', async () => {
    stubFetch(() => jsonResponse({ error: 'down' }, 503))
    const result = await readModels(options, new AbortController().signal)

    expect(result).toMatchObject({ ok: false, error: { reason: 'unreachable' } })
  })
})
