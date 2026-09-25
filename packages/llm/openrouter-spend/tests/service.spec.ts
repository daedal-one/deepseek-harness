import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
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
  data: [
    { id: 'a/b', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.00000075' } },
    { id: 'c/d', pricing: { prompt: '0.000001', completion: '0.000002' } },
  ],
}

interface Selection {
  readonly lastUsed: { readonly provider: string; readonly model: string } | null
  readonly next: { readonly provider: string; readonly model: string } | null
}

type CredentialResolver = { readonly resolve: (ref: unknown) => Promise<{ readonly value: string } | undefined> }

interface HarnessOverrides {
  readonly credentials?: CredentialResolver
  readonly modelSelection?: Selection
  /** Child-owned events used for pricing. */
  readonly events?: readonly SessionEvent[]
  /** Complete snapshot including an inherited fork prefix. */
  readonly allEvents?: readonly SessionEvent[]
  readonly keyReply?: (call: number, init: RequestInit | undefined) => Response | Promise<Response>
  readonly modelsReply?: () => Response | Promise<Response>
  readonly keyGate?: Promise<void>
}

const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
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

/** Await a gated response while honoring the request cancellation signal. */
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

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

function message(
  seq: number,
  usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number },
  provider = 'openrouter',
  model = 'a/b',
): SessionEvent {
  return event(seq, 'assistant/message', {
    turn: seq,
    step: 1,
    stream: [],
    message: {
      id: `message-${String(seq)}`,
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider, model },
    },
    usage,
  })
}

function failedAttempt(
  seq: number,
  usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number },
): SessionEvent {
  return event(seq, 'assistant/attempt', {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', time: seq, chunk: { type: 'usage', usage } }],
  })
}

async function harness(overrides: HarnessOverrides = {}): Promise<{
  ctx: Context
  service: OpenRouterSpendService
  keyCalls: () => number
  modelsCalls: () => number
  fetchSpy: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const session = {
    id: SESSION_ID,
    snapshotEvents: () => overrides.allEvents ?? overrides.events ?? [],
    ownEvents: () => overrides.events ?? [],
  } as unknown as Session
  let keyCalls = 0
  let modelsCalls = 0
  const fetchSpy = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = String(input)
    const signal = init?.signal
    if (url.endsWith('/key')) {
      keyCalls += 1
      await abortable(overrides.keyGate, signal)
      return overrides.keyReply?.(keyCalls, init) ?? jsonResponse(KEY_BODY)
    }
    if (url.endsWith('/models')) {
      modelsCalls += 1
      if (signal?.aborted === true) throw abortError()
      return overrides.modelsReply?.() ?? jsonResponse(MODELS_BODY)
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
    fetchSpy,
  }
}

const withKey = (value = 'fake-openrouter-key'): CredentialResolver => ({ resolve: async () => ({ value }) })

async function successfulRead(service: OpenRouterSpendService) {
  const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)
  if (!result.ok) throw new Error(`expected success, got ${result.error.reason}`)
  return result.value
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

  it('prices a live session from its settled OpenRouter usage', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'openrouter', model: 'a/b' }, next: null },
      events: [message(1, { inputTokens: 1200, outputTokens: 800, cacheReadTokens: 1000 })],
    })

    const result = await successfulRead(service)
    expect(result.session).toEqual({ provider: 'openrouter', model: 'a/b', costUsd: 0.01635 })
  })

  it('sums each settled OpenRouter model instead of repricing history at the latest model', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'openrouter', model: 'c/d' }, next: null },
      events: [
        message(1, { inputTokens: 100, outputTokens: 10 }, 'openrouter', 'a/b'),
        message(2, { inputTokens: 200, outputTokens: 20 }, 'openrouter', 'c/d'),
      ],
    })

    const result = await successfulRead(service)
    expect(result.session).toMatchObject({ provider: 'openrouter', model: 'c/d' })
    expect(result.session?.costUsd).toBeCloseTo(0.00069)
  })

  it('does not let a pending next model reprice historical settled usage', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: {
        lastUsed: { provider: 'openrouter', model: 'a/b' },
        next: { provider: 'openrouter', model: 'c/d' },
      },
      events: [message(1, { inputTokens: 100, outputTokens: 10 }, 'openrouter', 'a/b')],
    })

    const result = await successfulRead(service)
    expect(result.session).toMatchObject({ provider: 'openrouter', model: 'a/b' })
    expect(result.session?.costUsd).toBeCloseTo(0.00045)
  })

  it('prices failed retries from the durable request header and the final message source', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'openrouter', model: 'a/b' }, next: null },
      events: [
        event(1, 'request/header', { header: { config: { provider: 'openrouter', model: 'a/b' } }, reason: 'initial' }),
        failedAttempt(2, { inputTokens: 100, outputTokens: 10 }),
        event(3, 'llm/retry', { turn: 1, step: 1 }),
        event(4, 'llm/retry-started', { turn: 1, step: 1, retry: 1 }),
        message(5, { inputTokens: 200, outputTokens: 20 }),
      ],
    })

    const result = await successfulRead(service)
    expect(result.session?.costUsd).toBe(0.00135)
  })

  it('reports an unpriceable history when settled usage was routed outside OpenRouter', async () => {
    const { service, modelsCalls } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-chat' }, next: null },
      events: [message(1, { inputTokens: 100, outputTokens: 10 }, 'deepseek-official', 'deepseek-chat')],
    })

    expect((await successfulRead(service)).session).toEqual({
      provider: 'deepseek-official', model: 'deepseek-chat', costUsd: null,
    })
    expect(modelsCalls()).toBe(0)
  })

  it('reports an unpriceable history when a failed attempt has no durable route', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'openrouter', model: 'a/b' }, next: null },
      events: [failedAttempt(1, { inputTokens: 100, outputTokens: 10 })],
    })

    expect((await successfulRead(service)).session).toEqual({ provider: 'openrouter', model: 'a/b', costUsd: null })
  })

  it('reports session null when the live session has no model selection', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: null, next: null },
    })

    expect((await successfulRead(service)).session).toBeNull()
  })

  it('degrades to costUsd null when one routed model has no catalog entry', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'openrouter', model: 'not-in-catalog' }, next: null },
      events: [message(1, { inputTokens: 1000, outputTokens: 500 }, 'openrouter', 'not-in-catalog')],
    })

    expect((await successfulRead(service)).session).toEqual({
      provider: 'openrouter', model: 'not-in-catalog', costUsd: null,
    })
  })

  it('preserves a distinct failure when the catalog read fails after the key read', async () => {
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'openrouter', model: 'a/b' }, next: null },
      events: [message(1, { inputTokens: 1000, outputTokens: 500 })],
      modelsReply: () => new Response('down', { status: 503 }),
    })

    await expect(service.read({ sessionId: SESSION_ID }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { reason: 'unreachable' },
    })
  })

  it('prices only child-owned events rather than a fork-inherited parent prefix', async () => {
    const parent = message(1, { inputTokens: 1000, outputTokens: 500 }, 'openrouter', 'a/b')
    const child = message(2, { inputTokens: 100, outputTokens: 10 }, 'openrouter', 'c/d')
    const { service } = await harness({
      credentials: withKey(),
      modelSelection: { lastUsed: { provider: 'openrouter', model: 'c/d' }, next: null },
      allEvents: [parent, child],
      events: [child],
    })

    const result = await successfulRead(service)
    expect(result.session).toMatchObject({ provider: 'openrouter', model: 'c/d' })
    expect(result.session?.costUsd).toBeCloseTo(0.00012)
  })

  it('uses the key cache fetch time for cached snapshots', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { service, keyCalls } = await harness({ credentials: withKey() })

    expect((await successfulRead(service)).fetchedAt).toBe(1_000)
    vi.setSystemTime(2_000)
    expect((await successfulRead(service)).fetchedAt).toBe(1_000)
    expect(keyCalls()).toBe(1)
  })

  it('invalidates cached key usage when the credential fingerprint changes', async () => {
    let key = 'fake-key-a'
    const { service, keyCalls, fetchSpy } = await harness({
      credentials: { resolve: async () => ({ value: key }) },
      keyReply: (call) => jsonResponse({
        ...KEY_BODY,
        data: { ...KEY_BODY.data, label: `key-${String(call)}` },
      }),
    })

    expect((await successfulRead(service)).key.label).toBe('key-1')
    key = 'fake-key-b'
    expect((await successfulRead(service)).key.label).toBe('key-2')
    expect(keyCalls()).toBe(2)
    const authorization = fetchSpy.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).authorization)
    expect(authorization).toEqual(['Bearer fake-key-a', 'Bearer fake-key-b'])
  })

  it('clears cached usage when a credential is removed before the same key returns', async () => {
    let key: string | undefined = 'fake-key-a'
    const { service, keyCalls } = await harness({
      credentials: { resolve: async () => key === undefined ? undefined : { value: key } },
      keyReply: call => jsonResponse({
        ...KEY_BODY,
        data: { ...KEY_BODY.data, label: `key-${String(call)}` },
      }),
    })

    expect((await successfulRead(service)).key.label).toBe('key-1')
    key = undefined
    await expect(service.read({ sessionId: SESSION_ID }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { reason: 'not-configured' },
    })
    key = 'fake-key-a'
    expect((await successfulRead(service)).key.label).toBe('key-2')
    expect(keyCalls()).toBe(2)
  })

  it('does not cache a failed key read and recovers immediately', async () => {
    const { service, keyCalls } = await harness({
      credentials: withKey(),
      keyReply: (call) => call === 1
        ? new Response('unauthorized', { status: 401 })
        : jsonResponse(KEY_BODY),
    })

    await expect(service.read({ sessionId: SESSION_ID }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { reason: 'unauthorized' } })
    await expect(successfulRead(service)).resolves.toMatchObject({ key: {
      label: 'test key',
      usageUsd: 1,
      usageDailyUsd: 0.1,
      usageWeeklyUsd: 0.5,
      usageMonthlyUsd: 1,
      limitUsd: 100,
      limitRemainingUsd: 99,
      isFreeTier: false,
    } })
    expect(keyCalls()).toBe(2)
  })

  it('shares one in-flight key read across two concurrent calls', async () => {
    let releaseKey: () => void = () => {}
    const keyGate = new Promise<void>((resolve) => {
      releaseKey = resolve
    })
    const { service, keyCalls } = await harness({ credentials: withKey(), keyGate })

    const first = service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    const second = service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    releaseKey()
    const [a, b] = await Promise.all([first, second])
    expect(keyCalls()).toBe(1)
    expect(a).toEqual(b)
  })

  it('keeps a shared in-flight read alive when the caller that started it is cancelled', async () => {
    let releaseKey: () => void = () => {}
    const keyGate = new Promise<void>((resolve) => {
      releaseKey = resolve
    })
    const { service, keyCalls } = await harness({ credentials: withKey(), keyGate })

    const cancelled = new AbortController()
    const abandoned = service.read({ sessionId: SESSION_ID }, cancelled.signal)
    cancelled.abort()
    const joined = service.read({ sessionId: SESSION_ID }, new AbortController().signal)
    releaseKey()
    const [a, b] = await Promise.all([abandoned, joined])
    expect(keyCalls()).toBe(1)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })

  it('reads nothing when the caller is already cancelled', async () => {
    const { service, keyCalls } = await harness({ credentials: withKey() })
    const cancelled = new AbortController()
    cancelled.abort()

    const result = await service.read({ sessionId: SESSION_ID }, cancelled.signal)
    expect(result).toMatchObject({ ok: false, error: { reason: 'unreachable' } })
    expect(keyCalls()).toBe(0)
  })
})
