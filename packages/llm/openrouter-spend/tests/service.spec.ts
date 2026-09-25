import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import OpenRouterSpendService from '../src/service.ts'

const SESSION_ID = SessionId('session-1')

const KEY_BODY = {
  data: {
    label: 'test key',
    usage: 1,
    usage_daily: 0.1,
    usage_weekly: 0.5,
    usage_monthly: 1,
    limit: 100,
    limit_remaining: 99,
    is_free_tier: false,
  },
}

const MODELS_BODY = {
  data: [{ id: 'a/b', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.00000075' } }],
}

interface Selection {
  readonly lastUsed: { readonly provider: string; readonly model: string } | null
  readonly next: { readonly provider: string; readonly model: string } | null
}

interface HarnessOverrides {
  readonly credentials?: { readonly resolve: (ref: unknown) => Promise<{ readonly value: string } | undefined> }
  readonly modelSelection?: Selection
  readonly tokenUsage?: {
    readonly uncachedInputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
  }
  readonly keyGate?: Promise<void>
}

const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** One cancelled-request failure shaped like the DOMException `fetch` rejects with. */
function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

/**
 * Await a gated response the way `fetch` does: a request whose signal aborts
 * mid-flight rejects instead of resolving. Without this the stub would answer
 * a cancelled request, and no cancellation path could be observed.
 * @param operation - the gate the response waits behind, when the case sets one.
 * @param signal - the request signal the service combined with its timeout.
 * @returns the gate's settlement, or a rejection once the signal aborts.
 */
function abortable(operation: Promise<void> | undefined, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal === null || signal === undefined) return Promise.resolve(operation)
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { reject(abortError()) }
    signal.addEventListener('abort', onAbort, { once: true })
    void Promise.resolve(operation).then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function harness(overrides: HarnessOverrides = {}): Promise<{
  ctx: Context
  service: OpenRouterSpendService
  keyCalls: () => number
  modelsCalls: () => number
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const session = { id: SESSION_ID } as unknown as Session
  let keyCalls = 0
  let modelsCalls = 0
  const fetchSpy = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = String(input)
    const signal = init?.signal
    if (url.endsWith('/key')) {
      keyCalls += 1
      await abortable(overrides.keyGate, signal)
      return jsonResponse(KEY_BODY)
    }
    if (url.endsWith('/models')) {
      modelsCalls += 1
      if (signal?.aborted === true) throw abortError()
      return jsonResponse(MODELS_BODY)
    }
    throw new Error(`unexpected URL ${url}`)
  })
  vi.stubGlobal('fetch', fetchSpy)
  ctx.provide('sessions', { get: (id: string) => (id === SESSION_ID ? session : undefined) } as never)
  ctx.provide('sessionProjections', {
    snapshot: () => ({
      asOfSeq: 0,
      values: {
        ...overrides.modelSelection === undefined ? {} : { modelSelection: overrides.modelSelection },
        ...overrides.tokenUsage === undefined ? {} : { tokenUsage: overrides.tokenUsage },
      },
    }),
  } as never)
  if (overrides.credentials !== undefined) ctx.provide('credentials', overrides.credentials as never)
  const fiber = await ctx.plugin(OpenRouterSpendService, { baseURL: 'https://openrouter.test/api/v1' })
  await fiber.await()
  return {
    ctx,
    service: ctx.get('openrouterSpend') as OpenRouterSpendService,
    keyCalls: () => keyCalls,
    modelsCalls: () => modelsCalls,
  }
}

describe('OpenRouterSpendService', () => {
  it('publishes one read Remote method under the openrouterSpend namespace', async () => {
    const { service } = await harness()
    expect(service.typertRemote).toMatchObject({ serviceKey: 'openrouterSpend', namespace: 'openrouterSpend' })
    expect(remoteMethods(service)).toEqual([{ method: 'read', invocation: { kind: 'direct' } }])
  })

  it('reports not-configured without any fetch when no credential is available', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const { service, keyCalls } = await harness()

    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'not-configured' } })
    if (!result.ok) expect(result.error.detail).toContain('OPENROUTER_API_KEY')
    expect(keyCalls()).toBe(0)
  })

  it('reports not-configured when the credentials service resolves to nothing', async () => {
    const { service } = await harness({ credentials: { resolve: async () => undefined } })
    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'not-configured' } })
  })

  it('prices a live session with a catalog model exactly', async () => {
    const { service } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
      modelSelection: {
        lastUsed: { provider: 'openrouter', model: 'a/b' },
        next: { provider: 'openrouter', model: 'a/b' },
      },
      tokenUsage: { uncachedInputTokens: 1200, outputTokens: 800, cacheReadTokens: 1000, cacheWriteTokens: 0 },
    })

    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful read')
    expect(result.value.key).toEqual({
      label: 'test key',
      usageUsd: 1,
      usageDailyUsd: 0.1,
      usageWeeklyUsd: 0.5,
      usageMonthlyUsd: 1,
      limitUsd: 100,
      limitRemainingUsd: 99,
      isFreeTier: false,
    })
    expect(result.value.session?.provider).toBe('openrouter')
    expect(result.value.session?.model).toBe('a/b')
    expect(result.value.session?.costUsd).toBeCloseTo(0.01635, 12)
    expect(result.value.fetchedAt).toEqual(expect.any(Number))
  })

  it('falls back to lastUsed when next is null', async () => {
    const { service } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
      modelSelection: {
        lastUsed: { provider: 'openrouter', model: 'a/b' },
        next: null,
      },
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })

    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful read')
    expect(result.value.session).toEqual({ provider: 'openrouter', model: 'a/b', costUsd: 0 })
  })

  it('reports costUsd null, not 0, when the tokenUsage projection is absent', async () => {
    const { service, modelsCalls } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
      modelSelection: {
        lastUsed: { provider: 'openrouter', model: 'a/b' },
        next: { provider: 'openrouter', model: 'a/b' },
      },
    })

    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful read')
    expect(result.value.session).toEqual({ provider: 'openrouter', model: 'a/b', costUsd: null })
    expect(modelsCalls()).toBe(0)
  })

  it('reports session null when the session is not live', async () => {
    const { service } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
    })

    const result = await service.read({ sessionId: SessionId('missing') }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful read')
    expect(result.value.session).toBeNull()
  })

  it('reports session null when the live session has no model selection', async () => {
    const { service } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
      modelSelection: { lastUsed: null, next: null },
      tokenUsage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })

    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful read')
    expect(result.value.session).toBeNull()
  })

  it('degrades to costUsd null when the model has no catalog entry', async () => {
    const { service } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
      modelSelection: {
        lastUsed: { provider: 'openrouter', model: 'not-in-catalog' },
        next: { provider: 'openrouter', model: 'not-in-catalog' },
      },
      tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })

    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful read')
    expect(result.value.session).toEqual({ provider: 'openrouter', model: 'not-in-catalog', costUsd: null })
  })

  it('degrades to costUsd null when the catalog read fails, without failing the read', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const session = { id: SESSION_ID } as unknown as Session
    let keyCalls = 0
    const fetchSpy = vi.fn(async (input: URL | string) => {
      const url = String(input)
      if (url.endsWith('/key')) {
        keyCalls += 1
        return jsonResponse(KEY_BODY)
      }
      return new Response('down', { status: 503 })
    })
    vi.stubGlobal('fetch', fetchSpy)
    ctx.provide('sessions', { get: (id: string) => (id === SESSION_ID ? session : undefined) } as never)
    ctx.provide('sessionProjections', {
      snapshot: () => ({
        asOfSeq: 0,
        values: {
          modelSelection: {
            lastUsed: { provider: 'openrouter', model: 'a/b' },
            next: { provider: 'openrouter', model: 'a/b' },
          },
          tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      }),
    } as never)
    ctx.provide('credentials', { resolve: async () => ({ value: 'sk-test-key' }) } as never)
    await (await ctx.plugin(OpenRouterSpendService, {})).await()
    const service = ctx.get('openrouterSpend') as OpenRouterSpendService

    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful read')
    expect(result.value.session).toEqual({ provider: 'openrouter', model: 'a/b', costUsd: null })
  })

  it('shares one in-flight /key request across two concurrent reads', async () => {
    let releaseKey: () => void = () => {}
    const keyGate = new Promise<void>((resolve) => {
      releaseKey = resolve
    })
    const { service, keyCalls } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
      modelSelection: {
        lastUsed: { provider: 'openrouter', model: 'a/b' },
        next: { provider: 'openrouter', model: 'a/b' },
      },
      tokenUsage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      keyGate,
    })

    const first = service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    const second = service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    releaseKey()
    const [a, b] = await Promise.all([first, second])
    expect(keyCalls()).toBe(1)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(b.value).toEqual(a.value)
    }
  })

  it('keeps a shared in-flight read alive when the caller that started it is cancelled', async () => {
    let releaseKey: () => void = () => {}
    const keyGate = new Promise<void>((resolve) => {
      releaseKey = resolve
    })
    const { service, keyCalls } = await harness({
      credentials: { resolve: async () => ({ value: 'sk-test-key' }) },
      modelSelection: {
        lastUsed: { provider: 'openrouter', model: 'a/b' },
        next: { provider: 'openrouter', model: 'a/b' },
      },
      tokenUsage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      keyGate,
    })

    const cancelled = new AbortController()
    const abandoned = service.read({ sessionId: SESSION_ID }, cancelled.signal)
    cancelled.abort()
    const joined = service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    releaseKey()
    const [a, b] = await Promise.all([abandoned, joined])

    // One shared request, and the sharer that joined after the abort must not
    // inherit the cancelled caller's failure.
    expect(keyCalls()).toBe(1)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })

  it('reads nothing when the caller is already cancelled', async () => {
    const { service, keyCalls } = await harness({ credentials: { resolve: async () => ({ value: 'sk-test-key' }) } })
    const cancelled = new AbortController()
    cancelled.abort()

    const result = await service.read({ sessionId: SESSION_ID }, cancelled.signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'unreachable' } })
    expect(keyCalls()).toBe(0)
  })
})
