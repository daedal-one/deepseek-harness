import { afterEach, describe, expect, it, vi } from 'vitest'
import { readKeyUsage, readModels, type OpenRouterReadOptions } from '../src/openrouter.ts'

const KEY = 'sk-or-v1-secret-key-000'

const options: OpenRouterReadOptions = {
  baseURL: 'https://openrouter.test/api/v1',
  apiKey: KEY,
  requestTimeoutMs: 10_000,
}

const KEY_BODY = {
  data: {
    label: 'test key',
    usage: 1,
    usage_daily: 0.1,
    usage_weekly: 0.5,
    usage_monthly: 1,
    limit: null,
    limit_remaining: null,
    is_free_tier: false,
  },
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

/**
 * Install a fetch stub and return the recording function: vitest's
 * `vi.stubGlobal` returns its own wrapper, so call records are read from the
 * implementation itself.
 */
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

describe('readKeyUsage', () => {
  it('GETs the /key endpoint with the key only in the Authorization header', async () => {
    const fetchSpy = stubFetch(() => jsonResponse(KEY_BODY))
    const result = await readKeyUsage(options, new AbortController().signal)

    expect(result).toMatchObject({ ok: true, value: { label: 'test key', usageUsd: 1, limitUsd: null } })
    const { url, init } = lastFetchCall(fetchSpy)
    expect(url).toBe('https://openrouter.test/api/v1/key')
    expect(init.method).toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe(`Bearer ${KEY}`)
    expect(headers['user-agent']).toBe('deepseek-harness/0.1.5-alpha.2')
    expect(url).not.toContain(KEY)
  })

  it('trims a trailing slash from the endpoint base', async () => {
    const fetchSpy = stubFetch(() => jsonResponse(KEY_BODY))
    await readKeyUsage({ ...options, baseURL: 'https://openrouter.test/api/v1/' }, new AbortController().signal)
    expect(lastFetchCall(fetchSpy).url).toBe('https://openrouter.test/api/v1/key')
  })

  it('maps 401 and 403 to unauthorized', async () => {
    for (const status of [401, 403]) {
      vi.unstubAllGlobals()
      stubFetch(() => jsonResponse({ error: 'bad key' }, status))
      const result = await readKeyUsage(options, new AbortController().signal)
      expect(result, String(status)).toMatchObject({ ok: false, error: { reason: 'unauthorized' } })
      if (!result.ok) expect(result.error.detail).not.toContain(KEY)
    }
  })

  it('maps 429 to rate-limited', async () => {
    stubFetch(() => jsonResponse({ error: 'slow down' }, 429))
    const result = await readKeyUsage(options, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'rate-limited' } })
  })

  it('maps any other non-2xx status to unreachable with the status in the detail', async () => {
    stubFetch(() => jsonResponse({ error: 'down' }, 503))
    const result = await readKeyUsage(options, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'unreachable' } })
    if (!result.ok) expect(result.error.detail).toContain('503')
  })

  it('maps a thrown fetch error to unreachable without leaking the key', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    const result = await readKeyUsage(options, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'unreachable' } })
    if (!result.ok) expect(result.error.detail).not.toContain(KEY)
  })

  it('maps a caller abort to unreachable without leaking the key', async () => {
    // Real fetch rejects on an already-aborted signal; the stub honors the same contract.
    stubFetch(async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
      return jsonResponse(KEY_BODY)
    })
    const controller = new AbortController()
    controller.abort()
    const result = await readKeyUsage(options, controller.signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'unreachable' } })
    if (!result.ok) expect(result.error.detail).not.toContain(KEY)
  })

  it('maps a non-JSON body to malformed-response', async () => {
    stubFetch(() => new Response('not json', { status: 200 }))
    const result = await readKeyUsage(options, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'malformed-response' } })
  })

  it('maps a JSON body that fails its parser to malformed-response with the parser detail', async () => {
    stubFetch(() => jsonResponse({ data: { label: 7 } }))
    const result = await readKeyUsage(options, new AbortController().signal)
    expect(result).toMatchObject({
      ok: false,
      error: { reason: 'malformed-response', detail: '"data.label" must be a string' },
    })
  })
})

describe('readModels', () => {
  it('GETs the public /models endpoint', async () => {
    const fetchSpy = stubFetch(() => jsonResponse(MODELS_BODY))
    const result = await readModels(options, new AbortController().signal)

    expect(result).toEqual({ ok: true, value: [{ id: 'a/b', pricing: { prompt: '0.000001', completion: '0.000002', cacheRead: null, cacheWrite: null } }] })
    const { url, init } = lastFetchCall(fetchSpy)
    expect(url).toBe('https://openrouter.test/api/v1/models')
    const headers = init.headers as Record<string, string>
    expect(headers['user-agent']).toBe('deepseek-harness/0.1.5-alpha.2')
  })

  it('maps a malformed models body to malformed-response', async () => {
    stubFetch(() => jsonResponse({ data: 'nope' }))
    const result = await readModels(options, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'malformed-response', detail: '"data" must be an array' } })
  })
})
