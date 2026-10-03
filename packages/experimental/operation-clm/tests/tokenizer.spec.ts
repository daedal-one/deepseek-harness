import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import OperationService from '@deepseek-ai/dsh-experimental-operation'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/tokenizer.ts'
import { Config, LocalHttpTokenizer } from '../src/tokenizer.ts'

const config = {
  endpoint: 'http://127.0.0.1:1', credentialRef: 'TOKENIZER_KEY', tokenizerId: 'fixture-tokenizer',
  timeoutMs: 2_000, maxRequestBytes: 16_384, maxResponseBytes: 16_384,
  maxConcurrentRequests: 2, maxTexts: 32, maxTokensPerText: 1_024,
} satisfies Config
const clients: LocalHttpTokenizer[] = []
const contexts: Context[] = []
const closeServers: Array<() => Promise<void>> = []
const serverErrors: unknown[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await Promise.all(clients.splice(0).map(client => client.dispose()))
  await Promise.all(closeServers.splice(0).map(close => close()))
  expect(serverErrors.splice(0)).toEqual([])
})

function digest(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`
}

function response(texts: readonly string[]) {
  return {
    version: 1, tokenizer: config.tokenizerId,
    counts: texts.map((text, index) => ({ index, textDigest: digest(text), tokens: Buffer.byteLength(text, 'utf8') })),
  }
}

function reply(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function server(handler: (request: IncomingMessage, res: ServerResponse, body: unknown) => void): Promise<string> {
  const instance = createServer((request, res) => {
    let text = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { text += chunk })
    request.on('end', () => {
      try { handler(request, res, JSON.parse(text) as unknown) } catch (error: unknown) {
        serverErrors.push(error)
        res.destroy()
      }
    })
  })
  closeServers.push(async () => {
    const closing = new Promise<void>((resolve, reject) => {
      instance.close((error) => { if (error) reject(error); else resolve() })
    })
    instance.closeAllConnections()
    await closing
  })
  await new Promise<void>((resolve, reject) => {
    instance.once('error', reject)
    instance.listen(0, '127.0.0.1', resolve)
  })
  const address = instance.address()
  if (address === null || typeof address === 'string') throw new Error('fixture requires an allocated TCP port')
  return `http://127.0.0.1:${address.port}`
}

function tokenizer(endpoint: string, overrides: Partial<Config> = {}, resolveCredential = async () => 'fixture-secret') {
  const client = new LocalHttpTokenizer({ ...config, endpoint, ...overrides }, resolveCredential)
  clients.push(client)
  return client
}

class FixtureCredentials extends Service {
  readonly references: CredentialRef[] = []

  constructor(ctx: Context) {
    super(ctx, 'credentials')
  }

  async resolve(ref: CredentialRef) {
    this.references.push(ref)
    return { value: `fixture-secret-${this.references.length}`, source: 'fixture' }
  }
}

async function operationContext() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(SessionStore)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(OperationService)
  await ctx.plugin(FixtureCredentials)
  return ctx
}

describe('local HTTP exact tokenizer hook', () => {
  it('preserves Unicode, newlines, null-looking and empty strings in one bounded authenticated request', async () => {
    const texts = ['', '\n', 'null', '\0', '😀', '中文', 'e\u0301', 'é', '\ud800', '\udc00', 'a\r\nb', '"\\\t', '\ufeffstate']
    const requests: unknown[] = []
    const endpoint = await server((request, res, body) => {
      expect(request.method).toBe('POST')
      expect(request.url).toBe('/v1/tokenize')
      expect(request.headers.authorization).toBe('Bearer fixture-secret')
      requests.push(body)
      reply(res, response(texts))
    })
    const counts = await tokenizer(endpoint).countMany(texts, new AbortController().signal)
    expect(requests).toEqual([{ version: 1, tokenizer: config.tokenizerId, texts }])
    expect(counts).toEqual(texts.map(text => Buffer.byteLength(text, 'utf8')))
    expect(Object.isFrozen(counts)).toBe(true)
    expect(digest('e\u0301')).not.toBe(digest('é'))
  })

  it('copies caller inputs before asynchronous credentials and maps identical strings by their indices', async () => {
    const texts = ['original', 'original']
    const secret = Promise.withResolvers<string>()
    const endpoint = await server((_request, res, body) => {
      expect(body).toEqual({ version: 1, tokenizer: config.tokenizerId, texts: ['original', 'original'] })
      reply(res, { ...response(['original', 'original']), counts: [
        { index: 0, textDigest: digest('original'), tokens: 3 },
        { index: 1, textDigest: digest('original'), tokens: 4 },
      ] })
    })
    const task = tokenizer(endpoint, {}, async () => await secret.promise).countMany(texts, new AbortController().signal)
    texts[0] = 'mutated'
    texts.push('late')
    secret.resolve('fixture-secret')
    await expect(task).resolves.toEqual([3, 4])
  })

  it('uses the batch protocol for scalar count and accepts the exact per-text token cap', async () => {
    const endpoint = await server((_request, res, body) => {
      expect(body).toEqual({ version: 1, tokenizer: config.tokenizerId, texts: ['α'] })
      reply(res, response(['α']))
    })
    await expect(tokenizer(endpoint, { maxTexts: 1, maxTokensPerText: 2 }).count('α', new AbortController().signal)).resolves.toBe(2)
  })

  it('rejects wrong, extra, missing, reordered, or misassociated response fields without retrying', async () => {
    const texts = ['a', 'bb']
    const correct = response(texts)
    const variants: unknown[] = [
      null, [], 1, 'response', {},
      { ...correct, version: 2 }, { ...correct, version: '1' },
      { ...correct, tokenizer: 'other' }, { ...correct, extra: true },
      { version: 1, tokenizer: config.tokenizerId },
      { ...correct, counts: null }, { ...correct, counts: {} },
      { ...correct, counts: [] }, { ...correct, counts: correct.counts.slice(0, 1) },
      { ...correct, counts: [...correct.counts, correct.counts[0]] },
      { ...correct, counts: [...correct.counts].reverse() },
      ...[null, [], {},
        { index: 0, textDigest: digest('a') },
        { ...correct.counts[0], extra: true },
        ...[-1, 1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1].map(index => ({ ...correct.counts[0], index })),
        ...['wrong', digest('bb'), digest('a').toUpperCase(), null].map(textDigest => ({ ...correct.counts[0], textDigest })),
        ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 1_025, '1', null].map(tokens => ({ ...correct.counts[0], tokens })),
      ].map(entry => ({ ...correct, counts: [entry, correct.counts[1]] })),
    ]
    let requests = 0
    let next: unknown
    const endpoint = await server((_request, res) => { requests++; reply(res, next) })
    const client = tokenizer(endpoint)
    for (const body of variants) {
      next = body
      await expect(client.countMany(texts, new AbortController().signal)).rejects.toMatchObject({
        code: 'TOKENIZER_WIRE', message: 'tokenizer returned an invalid or mismatched response',
      })
    }
    expect(requests).toBe(variants.length)
  })

  it('rejects non-finite JSON numbers and invalid JSON without leaking the response', async () => {
    let next = ''
    const endpoint = await server((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(next)
    })
    const client = tokenizer(endpoint)
    for (const literal of ['1e999', '-1e999']) {
      next = `{"version":1,"tokenizer":"${config.tokenizerId}","counts":[{"index":0,"textDigest":"${digest('x')}","tokens":${literal}}]}`
      await expect(client.count('x', new AbortController().signal)).rejects.toMatchObject({ code: 'TOKENIZER_WIRE' })
    }
    for (const literal of ['NaN', 'Infinity', 'private-response']) {
      next = literal
      await expect(client.count('x', new AbortController().signal)).rejects.toMatchObject({
        code: 'LOCAL_WIRE', message: 'local endpoint returned invalid or incomplete JSON',
      })
    }
  })

  it('rejects empty and oversized batches before resolving credentials or dispatching HTTP', async () => {
    let resolves = 0
    const client = tokenizer(config.endpoint, { maxTexts: 1 }, async () => { resolves++; return 'fixture-secret' })
    for (const texts of [[], ['a', 'b']]) {
      await expect(client.countMany(texts, new AbortController().signal)).rejects.toMatchObject({ code: 'TOKENIZER_INPUT_LIMIT' })
    }
    expect(resolves).toBe(0)
  })

  it('requires every config cap and credential reference without defaults and snapshots accepted settings', async () => {
    expect(Config['~standard'].validate(config)).not.toHaveProperty('issues')
    const unsupportedTimer = { ...config, timeoutMs: 2_147_483_648 }
    expect(Config['~standard'].validate(unsupportedTimer)).toHaveProperty('issues.0')
    expect(() => new LocalHttpTokenizer(unsupportedTimer)).toThrow('supported timer range')
    for (const key of Object.keys(config)) {
      const missing = Object.fromEntries(Object.entries(config).filter(([name]) => name !== key))
      expect(Config['~standard'].validate(missing)).toHaveProperty('issues.0')
      expect(() => new LocalHttpTokenizer(missing as unknown as Config)).toThrow()
    }
    for (const key of ['maxTexts', 'maxTokensPerText'] as const) {
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => new LocalHttpTokenizer({ ...config, [key]: value })).toThrow('positive safe integer')
      }
    }
    for (const credentialRef of ['', 'invalid-reference']) {
      expect(() => new LocalHttpTokenizer({ ...config, credentialRef })).toThrow('credential ref')
    }
    expect(() => new LocalHttpTokenizer({ ...config, tokenizerId: '' })).toThrow('tokenizerId')
    const endpoint = await server((_request, res, body) => {
      expect(body).toEqual({ version: 1, tokenizer: config.tokenizerId, texts: ['ok'] })
      reply(res, response(['ok']))
    })
    const mutable = { ...config, endpoint }
    const client = new LocalHttpTokenizer(mutable, async () => 'fixture-secret')
    clients.push(client)
    Object.assign(mutable, { tokenizerId: 'changed', endpoint: config.endpoint, maxTexts: 0, maxTokensPerText: 0 })
    await expect(client.count('ok', new AbortController().signal)).resolves.toBe(2)
  })

  it('sanitizes malformed credential references before direct construction or plugin registration', () => {
    const secret = 'pasted-private-token/invalid'
    const ctx = new Context()
    contexts.push(ctx)
    const invalid = { ...config, credentialRef: secret }
    for (const construct of [() => new LocalHttpTokenizer(invalid), () => { plugin.apply(ctx, invalid) }]) {
      let failure: unknown
      try { construct() } catch (error: unknown) { failure = error }
      expect(failure).toMatchObject({ code: 'TOKENIZER_CONFIG', message: 'tokenizer credential reference is invalid' })
      expect(String(failure)).not.toContain(secret)
    }
  })

  it.each(['cancel', 'dispose'] as const)('settles an owned HTTP request on %s and rejects late admission after disposal', async (mode) => {
    const entered = Promise.withResolvers<undefined>()
    const endpoint = await server(() => { entered.resolve(undefined) })
    const client = tokenizer(endpoint)
    const controller = new AbortController()
    let settled = false
    const task = client.count('pending', controller.signal).catch((error: unknown) => { settled = true; return error })
    await entered.promise
    if (mode === 'cancel') controller.abort()
    else {
      await Promise.all([client.dispose(), client.dispose()])
      expect(settled).toBe(true)
    }
    expect(await task).toMatchObject({ code: mode === 'cancel' ? 'LOCAL_CANCELLED' : 'LOCAL_DISPOSED' })
    await client.dispose()
    await expect(client.count('later', new AbortController().signal)).rejects.toMatchObject({ code: 'LOCAL_DISPOSED' })
  })

  it('bounds full serialized request bytes, full response bytes, and concurrent admission through shared transport', async () => {
    const entered = Promise.withResolvers<undefined>()
    const endpoint = await server(() => { entered.resolve(undefined) })
    const client = tokenizer(endpoint, { maxConcurrentRequests: 1 })
    const pending = client.count('pending', new AbortController().signal).catch((error: unknown) => error)
    await entered.promise
    await expect(client.count('excess', new AbortController().signal)).rejects.toMatchObject({ code: 'LOCAL_BUSY' })
    await client.dispose()
    expect(await pending).toMatchObject({ code: 'LOCAL_DISPOSED' })
    const bodyEndpoint = await server((_request, res) => { reply(res, response(['α'])) })
    const requestBytes = Buffer.byteLength(JSON.stringify({ version: 1, tokenizer: config.tokenizerId, texts: ['α'] }), 'utf8')
    const responseBytes = Buffer.byteLength(JSON.stringify(response(['α'])), 'utf8')
    await expect(tokenizer(bodyEndpoint, { maxRequestBytes: requestBytes, maxResponseBytes: responseBytes }).count('α', new AbortController().signal)).resolves.toBe(2)
    await expect(tokenizer(bodyEndpoint, { maxRequestBytes: requestBytes - 1 }).count('α', new AbortController().signal)).rejects.toMatchObject({ code: 'LOCAL_BODY_LIMIT' })
    await expect(tokenizer(bodyEndpoint, { maxResponseBytes: responseBytes - 1 }).count('α', new AbortController().signal)).rejects.toMatchObject({ code: 'LOCAL_BODY_LIMIT' })
  })

  it('registers by named plugin exports, resolves credentials per request, and removes its hook before disposal completes', async () => {
    expect('default' in plugin).toBe(false)
    expect(plugin.inject).toEqual(['operations', 'credentials'])
    const authorizations: Array<string | undefined> = []
    const pending = Promise.withResolvers<undefined>()
    const endpoint = await server((request, res, body) => {
      authorizations.push(request.headers.authorization)
      if (authorizations.length === 3) { pending.resolve(undefined); return }
      expect(body).toEqual({ version: 1, tokenizer: config.tokenizerId, texts: ['a'] })
      reply(res, response(['a']))
    })
    const ctx = await operationContext()
    const fiber = ctx.plugin(plugin, { ...config, endpoint })
    await fiber
    const hook = ctx.operations.judgments.requireTokenizer(config.tokenizerId)
    await expect(hook.count('a', new AbortController().signal)).resolves.toBe(1)
    await expect(hook.count('a', new AbortController().signal)).resolves.toBe(1)
    const task = hook.count('pending', new AbortController().signal).catch((error: unknown) => error)
    await pending.promise
    await fiber.dispose()
    expect(() => ctx.operations.judgments.requireTokenizer(config.tokenizerId)).toThrow('not configured')
    expect(await task).toMatchObject({ code: 'LOCAL_DISPOSED' })
    expect(authorizations).toEqual(['Bearer fixture-secret-1', 'Bearer fixture-secret-2', 'Bearer fixture-secret-3'])
    await expect(hook.count('a', new AbortController().signal)).rejects.toMatchObject({ code: 'LOCAL_DISPOSED' })
  })
})
