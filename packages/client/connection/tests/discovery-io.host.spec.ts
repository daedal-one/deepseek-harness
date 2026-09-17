/** Status-process quiescence and credential-free response-body bounds. */
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createDiscoveryIo, TailscaleUnavailable } from '../src/discovery-io.ts'
import { tailnetOriginSchema } from '../src/discovery-protocol.ts'
import { advertisement, discoveryConfig } from './discovery-fixture.ts'

const origin = tailnetOriginSchema.parse('http://100.64.0.1:3081')
const signal = (): AbortSignal => new AbortController().signal
async function executable(body: string): Promise<{ path: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-discovery-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'tailscale')
  await writeFile(path, `#!${process.execPath}\n${body}\n`, { mode: 0o700 })
  return { path, root }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe.skipIf(process.platform === 'win32')('local status executable (POSIX shebang fixture)', () => {
  it('passes fixed arguments and a scrubbed environment', async () => {
    vi.stubEnv('DSH_DISCOVERY_TEST', 'private'); vi.stubEnv('DISCOVERY_TEST_API_TOKEN', 'private')
    const fixture = await executable('process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cli: process.env.TAILSCALE_BE_CLI, private: process.env.DISCOVERY_TEST_API_TOKEN, dsh: process.env.DSH_DISCOVERY_TEST }))')
    const io = createDiscoveryIo({ ...discoveryConfig, executable: fixture.path })
    expect(await io.readStatus(signal())).toEqual({ args: ['status', '--json'], cli: '1' })
  })
  it.each([
    ['process.exitCode = 6', 'Tailscale status failed', 1000],
    ['process.stdout.write("{")', 'JSON', 1000],
    ['process.stdout.write("x".repeat(1000))', 'byte limit', 64],
  ])('refuses failed, malformed or oversized status: %s', async (script, message, maxStatusBytes) => {
    const fixture = await executable(script)
    await expect(createDiscoveryIo({ ...discoveryConfig, executable: fixture.path, maxStatusBytes }).readStatus(signal()))
      .rejects.toThrow(message)
  })
  it('waits for process close after cancellation and suppresses partial stdout', async () => {
    const fixture = await executable('require("node:fs").writeFileSync(require("node:path").join(__dirname,"pid"), String(process.pid)); process.stdout.write("{}"); setInterval(() => {}, 1000)')
    const controller = new AbortController()
    const result = createDiscoveryIo({ ...discoveryConfig, executable: fixture.path }).readStatus(controller.signal)
    let pid = 0
    const rejected = expect(result).rejects.toThrow('caller ended')
    try {
      await vi.waitFor(async () => { pid = Number(await readFile(join(fixture.root, 'pid'), 'utf8')); expect(pid).toBeGreaterThan(0) })
      controller.abort(new Error('caller ended')); await rejected
      expect(() => process.kill(pid, 0)).toThrow()
    } finally { controller.abort(new Error('caller ended')); await result.catch(() => {}) }
  })
  it('bounds a status process even when it produces no output', async () => {
    const fixture = await executable('setInterval(() => {}, 1000)')
    await expect(createDiscoveryIo({ ...discoveryConfig, executable: fixture.path, statusTimeoutMs: 20 }).readStatus(signal()))
      .rejects.toThrow('timed out')
  })
  it('separates a missing executable from other spawn failures', async () => {
    const fixture = await executable('process.stdout.write("{}")')
    await expect(createDiscoveryIo({ ...discoveryConfig, executable: join(fixture.root, 'absent') }).readStatus(signal()))
      .rejects.toBeInstanceOf(TailscaleUnavailable)
    await expect(createDiscoveryIo({ ...discoveryConfig, executable: fixture.root }).readStatus(signal()))
      .rejects.not.toBeInstanceOf(TailscaleUnavailable)
  })
})

describe('advertisement HTTP adapter', () => {
  it('bypasses the ambient dispatcher and refuses a real redirect without reaching its target', async () => {
    const requests: { path: string | undefined; authorization: string | undefined; cookie: string | undefined }[] = []
    const server = createServer((request, response) => {
      requests.push({ path: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie })
      if (requests.length === 1) response.writeHead(302, { location: '/must-not-follow' }).end()
      else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(advertisement))
    })
    const old = getGlobalDispatcher(); const blocked = new MockAgent(); blocked.disableNetConnect()
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const address = server.address(); if (address === null || typeof address === 'string') throw new Error('missing listener')
      setGlobalDispatcher(blocked)
      const io = createDiscoveryIo(discoveryConfig, (url, init) => {
        const actual = new URL(url instanceof Request ? url.url : url); actual.hostname = '127.0.0.1'; actual.port = String(address.port)
        return fetch(actual, init)
      })
      await expect(io.probe(origin, signal())).rejects.toThrow()
      expect(requests).toHaveLength(1)
      expect(await io.probe(origin, signal())).toEqual(advertisement)
      expect(requests).toEqual(Array.from({ length: 2 }, () => ({ path: '/api/connection/discovery/advertisement', authorization: undefined, cookie: undefined })))
    } finally {
      setGlobalDispatcher(old)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error === undefined) resolve(); else reject(error) }) })
      await blocked.close()
    }
  })

  it('uses the exact anonymous GET policy and decodes a bounded complete response', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(advertisement)))
    const io = createDiscoveryIo(discoveryConfig, fetcher)
    expect(await io.probe(origin, signal())).toEqual(advertisement)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${origin}/api/connection/discovery/advertisement`, {
      method: 'GET', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) as unknown,
      dispatcher: expect.any(Object) as unknown,
    })
  })
  it.each([302, 401, 500])('cancels refused HTTP %s bodies', async (status) => {
    const cancelled = vi.fn()
    const response = new Response(new ReadableStream({ cancel: cancelled }), { status, headers: { location: 'http://127.0.0.1' } })
    await expect(createDiscoveryIo(discoveryConfig, () => Promise.resolve(response)).probe(origin, signal())).rejects.toThrow('unavailable')
    expect(cancelled).toHaveBeenCalledTimes(1)
  })
  it('rejects absent and malformed bodies', async () => {
    await expect(createDiscoveryIo(discoveryConfig, () => Promise.resolve(new Response(null))).probe(origin, signal())).rejects.toThrow('unavailable')
    await expect(createDiscoveryIo(discoveryConfig, () => Promise.resolve(new Response('{'))).probe(origin, signal())).rejects.toThrow()
  })
  it('limits streamed bytes without trusting Content-Length and waits for cancellation', async () => {
    const released = Promise.withResolvers<undefined>(); const cancelled = Promise.withResolvers<undefined>()
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(discoveryConfig.maxAdvertisementBytes + 1))
    }, cancel() { cancelled.resolve(undefined); return released.promise } })
    const io = createDiscoveryIo(discoveryConfig, () => Promise.resolve(new Response(body, { headers: { 'content-length': '1' } })))
    let settled = false; const result = io.probe(origin, signal()).finally(() => { settled = true })
    const rejected = expect(result).rejects.toThrow('byte limit')
    try { await cancelled.promise; expect(settled).toBe(false); released.resolve(undefined); await rejected }
    finally { released.resolve(undefined); await result.catch(() => {}) }
  })
  it('rejects before dispatch and cancels a body returned after parent cancellation', async () => {
    const parent = new AbortController(); parent.abort(new Error('before'))
    const fetcher = vi.fn<typeof fetch>()
    await expect(createDiscoveryIo(discoveryConfig, fetcher).probe(origin, parent.signal)).rejects.toThrow('before')
    expect(fetcher).not.toHaveBeenCalled()
    expect(() => createDiscoveryIo(discoveryConfig).readStatus(parent.signal)).toThrow('before')
    const late = new AbortController(); const cancelled = vi.fn()
    await expect(createDiscoveryIo(discoveryConfig, () => {
      late.abort(new Error('late'))
      return Promise.resolve(new Response(new ReadableStream({ cancel: cancelled })))
    }).probe(origin, late.signal)).rejects.toThrow('late')
    expect(cancelled).toHaveBeenCalledTimes(1)
  })
  it('bounds fetch and body acquisition and forwards parent cancellation', async () => {
    vi.useFakeTimers()
    const fetcher: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => {
        const reason: unknown = init!.signal!.reason
        reject(reason instanceof Error ? reason : new Error('Cancelled'))
      }, { once: true })
    })
    const io = createDiscoveryIo(discoveryConfig, fetcher)
    const timed = io.probe(origin, signal()); const rejected = expect(timed).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(discoveryConfig.probeTimeoutMs); await rejected
    const controller = new AbortController(); const aborted = io.probe(origin, controller.signal)
    const abortRejected = expect(aborted).rejects.toThrow('parent ended'); controller.abort(new Error('parent ended')); await abortRejected
  })
  it('preserves a failed body read when cancelling an already errored stream', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('body failed')) } })
    await expect(createDiscoveryIo(discoveryConfig, () => Promise.resolve(new Response(body))).probe(origin, signal())).rejects.toThrow('body failed')
  })
})
