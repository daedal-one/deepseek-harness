import { afterEach, describe, expect, it } from 'vitest'
import { LocalHttpClient } from '@deepseek-ai/dsh-experimental-operation-clm/local-http'
import { fixtureConfig, json, secret, startServer } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(
  handler: Parameters<typeof startServer>[0], options: Partial<ReturnType<typeof fixtureConfig>> = {},
  resolveCredential: () => Promise<string | undefined> = async () => secret,
) {
  const server = await startServer(handler)
  cleanups.push(() => server.dispose())
  const client = new LocalHttpClient(fixtureConfig(server.endpoint, options), resolveCredential)
  cleanups.push(() => client.dispose())
  return client
}
const signal = () => new AbortController().signal

describe('owned local HTTP transport', () => {
  it('accepts the exact request/response byte ceiling including multibyte text', async () => {
    const text = JSON.stringify({ text: '🚀' })
    const size = Buffer.byteLength(text)
    const client = await fixture((_req, res) => { json(res, { text: '🚀' }) }, { maxRequestBytes: size, maxResponseBytes: size })
    await expect(client.post('/v1/prepare', { text: '🚀' }, signal())).resolves.toEqual({ text: '🚀' })
    await expect(client.post('/v1/prepare', { text: '🚀x' }, signal())).rejects.toMatchObject({ code: 'LOCAL_BODY_LIMIT' })
  })

  it('rejects a chunked response whose complete bytes exceed the cap and closes its stream', async () => {
    const closed = Promise.withResolvers<undefined>()
    const client = await fixture((_req, res) => {
      res.on('close', () => { closed.resolve(undefined) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"text":"')
      res.write('🚀'.repeat(100))
    }, { maxResponseBytes: 32 })
    await expect(client.post('/v1/prepare', {}, signal())).rejects.toMatchObject({ code: 'LOCAL_BODY_LIMIT' })
    await closed.promise
  })

  it.each([
    ['declared overflow', (res: import('node:http').ServerResponse) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '10000' }); res.end('{}') }, 'LOCAL_BODY_LIMIT'],
    ['non JSON', (res: import('node:http').ServerResponse) => { res.end('{}') }, 'LOCAL_CONTENT_TYPE'],
    ['truncated JSON', (res: import('node:http').ServerResponse) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{') }, 'LOCAL_WIRE'],
    ['invalid UTF8', (res: import('node:http').ServerResponse) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(Buffer.from([123, 34, 255, 34, 58, 48, 125])) }, 'LOCAL_WIRE'],
    ['partial status', (res: import('node:http').ServerResponse) => { res.writeHead(206, { 'content-type': 'application/json' }); res.end(secret) }, 'LOCAL_HTTP_STATUS'],
    ['redirect', (res: import('node:http').ServerResponse) => { res.writeHead(302, { location: '/v1/decision' }); res.end(secret) }, 'LOCAL_TRANSPORT'],
  ])('rejects %s without exposing raw response bodies', async (_name, reply, code) => {
    const client = await fixture((_req, res) => { reply(res) }, { maxResponseBytes: 100 })
    const error = await client.post('/v1/prepare', {}, signal()).catch((error: unknown) => error)
    expect(error).toMatchObject({ code })
    expect(String(error)).not.toContain(secret)
  })

  it.each(['caller', 'deadline', 'dispose'] as const)('aborts a partial response on %s and disallows new requests after disposal', async (source) => {
    const entered = Promise.withResolvers<undefined>()
    const closed = Promise.withResolvers<undefined>()
    const client = await fixture((_req, res) => {
      res.on('close', () => { closed.resolve(undefined) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{')
      entered.resolve(undefined)
    }, { timeoutMs: source === 'deadline' ? 50 : 1_000 })
    const caller = new AbortController()
    const outcome = client.post('/v1/decision', {}, caller.signal).catch((error: unknown) => error)
    await entered.promise
    if (source === 'caller') caller.abort(new Error(secret))
    if (source === 'dispose') await client.dispose()
    expect(await outcome).toMatchObject({ code: source === 'caller' ? 'LOCAL_CANCELLED' : source === 'deadline' ? 'LOCAL_TIMEOUT' : 'LOCAL_DISPOSED' })
    await closed.promise
    if (source === 'dispose') await expect(client.post('/v1/prepare', {}, signal())).rejects.toMatchObject({ code: 'LOCAL_DISPOSED' })
  })

  it('keeps credential resolution owned through disposal and never sends a late secret', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<string>()
    let requests = 0
    const client = await fixture((_req, res) => { requests++; json(res, {}) }, {}, async () => {
      entered.resolve(undefined)
      return await release.promise
    })
    const outcome = client.post('/v1/prepare', {}, signal()).catch((error: unknown) => error)
    await entered.promise
    let disposed = false
    const disposing = client.dispose().then(() => { disposed = true })
    try {
      await Promise.resolve()
      expect(disposed).toBe(false)
      await expect(client.post('/v1/prepare', {}, signal())).rejects.toMatchObject({ code: 'LOCAL_DISPOSED' })
    } finally { release.resolve(secret) }
    await disposing
    expect(await outcome).toMatchObject({ code: 'LOCAL_DISPOSED' })
    expect(requests).toBe(0)
  })

  it('rejects excess concurrent admission without queuing or retries', async () => {
    const entered = Promise.withResolvers<undefined>()
    let requests = 0
    const client = await fixture((_req, res) => {
      requests++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{')
      entered.resolve(undefined)
    }, { maxConcurrentRequests: 1 })
    const caller = new AbortController()
    const outcome = client.post('/v1/prepare', {}, caller.signal).catch((error: unknown) => error)
    await entered.promise
    await expect(client.post('/v1/prepare', {}, signal())).rejects.toMatchObject({ code: 'LOCAL_BUSY' })
    caller.abort()
    await outcome
    expect(requests).toBe(1)
  })

  it('resolves credentials for every request and sanitizes lookup/header/remote failures', async () => {
    const observed: Array<string | undefined> = []
    let value = 'first-synthetic-secret'
    const client = await fixture((req, res) => { observed.push(req.headers.authorization); json(res, {}) }, {}, async () => value)
    await client.post('/v1/prepare', {}, signal())
    value = 'rotated-synthetic-secret'
    await client.post('/v1/decision', {}, signal())
    expect(observed).toEqual(['Bearer first-synthetic-secret', 'Bearer rotated-synthetic-secret'])
    for (const resolver of [async () => `${secret}\n`, async () => `\u0100${secret}`, async () => '', async () => { throw new Error(secret) }]) {
      const failing = await fixture((_req, res) => { throw new Error(`must not dispatch ${res.statusCode}`) }, {}, resolver)
      const error = await failing.post('/v1/prepare', {}, signal()).catch((error: unknown) => error)
      expect(error).toMatchObject({ code: 'LOCAL_CREDENTIAL' })
      expect(String(error)).not.toContain(secret)
    }
  })
})
