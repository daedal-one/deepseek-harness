import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserDeviceAdministration } from '../src/client/device-administration.ts'
import type { ConnectionGeneration, RpcFetch } from '../src/client/index.ts'
import { connectionIdentitySchema } from '../src/host-identity-protocol.ts'
import { connectionDeviceInfoSchema } from '../src/device-protocol.ts'

const identity = connectionIdentitySchema.parse({ version: 1,
  hostId: '10000000-0000-4000-8000-000000000001', activationId: '10000000-0000-4000-8000-000000000002' })
const device = connectionDeviceInfoSchema.parse({ deviceId: '20000000-0000-4000-8000-000000000001', label: 'My iPhone', createdAt: 1 })
const second = connectionDeviceInfoSchema.parse({ ...device, deviceId: '20000000-0000-4000-8000-000000000002', label: 'Tablet' })
const origin = 'https://host.example.test:3081'
const enrollment = () => ({ version: 1, hostId: identity.hostId, challenge: 'a'.repeat(43), expiresAt: Date.now() + 60_000 })
const list = (devices = [device]) => ({ version: 1, hostId: identity.hostId, devices })
const ok = (value: unknown) => Response.json({ ok: true, value })
const failure = (code: string, status = 409) => Response.json({ ok: false, error: { code, message: 'PRIVATE WIRE DETAIL', details: {} } }, { status })
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); vi.useRealTimers() })

function bench(available = true) {
  let current: ConnectionGeneration | undefined = { id: 1, host: { home: '/home', identity } }
  const listeners = new Set<() => void>()
  const fetch = vi.fn<RpcFetch>().mockImplementation(() => Promise.resolve(ok(list())))
  const service = new BrowserDeviceAdministration({ origin: available ? origin : undefined, fetch,
    generation: { getSnapshot: () => current,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  })
  cleanup.push(() => service.dispose())
  service.start()
  return { service, fetch, listeners, snapshot: () => service.state.getSnapshot(),
    publish(value: ConnectionGeneration | undefined) { current = value; for (const listener of [...listeners]) listener() },
    async open() { service.open(); await vi.waitFor(() => { expect(service.state.getSnapshot().busy).toBeNull() }) },
  }
}
function delayed(b: ReturnType<typeof bench>) {
  let release!: (response: Response) => void
  let signal: AbortSignal | undefined
  const response = new Promise<Response>((resolve) => { release = resolve })
  b.fetch.mockImplementationOnce((_url, init) => { signal = init.signal ?? undefined; return response })
  // Release before the fixture's disposal barrier, including when an assertion fails.
  cleanup.unshift(async () => { release(ok(list())) })
  return { release, signal: () => signal }
}

describe('browser owner device administration', () => {
  it('discards a validated enrollment if the section closes before publication', async () => {
    const b = bench(); await b.open()
    let read!: () => void
    let decoded!: (value: unknown) => void
    const reading = new Promise<void>((resolve) => { read = resolve })
    const body = new Promise<unknown>((resolve) => { decoded = resolve })
    cleanup.unshift(async () => { decoded(enrollment()) })
    b.fetch.mockResolvedValueOnce({ ok: true, status: 200, json() { read(); return body } })
    const attempt = b.service.enroll()
    await reading
    // Decoded-field access marks validation after the transport's abort check; closure precedes publication.
    const value = enrollment()
    decoded({ ok: true, value: { ...value, get hostId() {
      queueMicrotask(() => { b.service.close() })
      return value.hostId
    } } })
    await attempt
    expect(b.snapshot()).toMatchObject({ status: 'idle', enrollment: null, busy: null })
  })
  it('maps an unrecognized business refusal to a fixed diagnostic', async () => {
    const b = bench(); await b.open()
    b.fetch.mockResolvedValueOnce(failure('unrecognized/server-detail'))
    await b.service.enroll()
    expect(b.snapshot()).toMatchObject({ status: 'error', error: 'invalid-response', enrollment: null })
  })

  it('reads only while open, using same-origin cookies and exact request options', async () => {
    const b = bench()
    expect(b.fetch).not.toHaveBeenCalled()
    await b.open()
    expect(b.snapshot()).toMatchObject({ status: 'ready', hostId: identity.hostId, devices: [device], origin })
    const [url, init] = b.fetch.mock.calls[0]!
    expect(String(url)).toBe(`${origin}/api/connection/devices`)
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/json' } })
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).has('authorization')).toBe(false)
    b.service.close()
    expect(b.snapshot().devices).toEqual([])
    await b.service.refresh()
    expect(b.fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps unsupported carriers and generations without identity disconnected from owner routes', async () => {
    const privateCarrier = bench(false)
    await privateCarrier.open()
    expect(privateCarrier.snapshot().status).toBe('unavailable')
    expect(privateCarrier.fetch).not.toHaveBeenCalled()
    const b = bench()
    b.publish({ id: 1, host: { home: '/home' } })
    await b.open()
    expect(b.snapshot().status).toBe('disconnected')
    expect(b.fetch).not.toHaveBeenCalled()
  })
  it.each(['file:///tmp', 'https://host.example.test/path', 'https://user:pass@host.example.test'])('rejects a non-origin browser input %s', (value) => {
    expect(() => new BrowserDeviceAdministration({ origin: value, fetch: vi.fn(), generation: { getSnapshot: () => undefined, subscribe: () => () => {} } })).toThrow('complete HTTP(S) origin')
  })
  it('suppresses repeated gestures and discards late list results after closing', async () => {
    const b = bench()
    const pending = delayed(b)
    b.service.open(); b.service.open()
    await b.service.refresh()
    expect(b.fetch).toHaveBeenCalledTimes(1)
    b.service.close()
    expect(pending.signal()?.aborted).toBe(true)
    pending.release(ok(list()))
    await b.service.dispose()
    expect(b.snapshot()).toMatchObject({ status: 'idle', devices: [], enrollment: null, busy: null })
  })
  it.each([
    { value: { ...list(), extra: true } },
    { value: list([device, device]) },
    { value: { ...list(), hostId: '30000000-0000-4000-8000-000000000001' } },
    { value: { ...list(), devices: [{ ...device, credential: 'hidden' }] } },
    { value: list(), status: 500 },
  ])('refuses unverifiable list payloads %j', async ({ value, status }) => {
    const b = bench()
    b.fetch.mockResolvedValueOnce(Response.json({ ok: true, value }, { status: status ?? 200 }))
    await b.open()
    expect(b.snapshot()).toMatchObject({ status: 'error', error: 'invalid-response', devices: [] })
  })
  it.each([[401, 'owner-required'], [403, 'owner-required'], [404, 'unavailable']] as const)('maps HTTP %i without exposing wire text', async (status, error) => {
    const b = bench()
    b.fetch.mockResolvedValueOnce(new Response('PRIVATE WIRE DETAIL', { status }))
    await b.open()
    expect(b.snapshot().error).toBe(error)
    expect(JSON.stringify(b.snapshot())).not.toContain('PRIVATE')
  })
  it('retains metadata after a failed read but requires a successful refresh before mutation', async () => {
    const b = bench(); await b.open()
    b.fetch.mockRejectedValueOnce(new Error('network'))
    await b.service.refresh()
    expect(b.snapshot()).toMatchObject({ status: 'error', devices: [device], error: 'read-failed' })
    await b.service.enroll(); await b.service.revoke(device.deviceId)
    expect(b.fetch).toHaveBeenCalledTimes(2)
    await b.service.refresh()
    expect(b.snapshot()).toMatchObject({ status: 'ready', error: null })
  })
  it('creates one challenge in a JSON body and erases it on expiry without persisting it', async () => {
    const b = bench(); await b.open()
    vi.useFakeTimers()
    const value = enrollment()
    b.fetch.mockResolvedValueOnce(ok(value))
    await b.service.enroll()
    expect(b.snapshot().enrollment).toEqual(value)
    expect(b.fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{}' })
    expect(String(b.fetch.mock.calls[1]?.[0])).toBe(`${origin}/api/connection/devices/enroll`)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(b.snapshot()).toMatchObject({ status: 'ready', enrollment: null, error: 'expired' })
  })
  it.each(['wrong-host', 'expired', 'malformed'] as const)('refuses %s enrollment responses', async (kind) => {
    const b = bench(); await b.open()
    const value = enrollment()
    b.fetch.mockResolvedValueOnce(ok(kind === 'wrong-host' ? { ...value, hostId: '30000000-0000-4000-8000-000000000001' }
      : kind === 'expired' ? { ...value, expiresAt: 0 } : { ...value, challenge: 'bad' }))
    await b.service.enroll()
    expect(b.snapshot()).toMatchObject({ enrollment: null, status: 'error', error: kind === 'expired' ? 'expired' : 'invalid-response' })
  })
  it('hides an in-flight challenge and ignores its late response', async () => {
    const b = bench(); await b.open()
    const pending = delayed(b)
    const attempt = b.service.enroll()
    b.service.hideEnrollment()
    expect(pending.signal()?.aborted).toBe(true)
    pending.release(ok(enrollment())); await attempt
    expect(b.snapshot()).toMatchObject({ enrollment: null, busy: null, status: 'ready' })
    expect(b.fetch).toHaveBeenCalledTimes(2)
  })
  it('does not replay an uncertain enrollment and reports a pending-code limit', async () => {
    const b = bench(); await b.open()
    b.fetch.mockRejectedValueOnce(new Error('response lost'))
    await b.service.enroll(); await b.service.enroll()
    expect(b.snapshot().error).toBe('enrollment-unknown')
    expect(b.fetch).toHaveBeenCalledTimes(2)
    await b.service.refresh()
    b.fetch.mockResolvedValueOnce(failure('connection/enrollment-limit'))
    await b.service.enroll()
    expect(b.snapshot().error).toBe('enrollment-limit')
  })
  it.each([true, false])('removes only the confirmed device when the Host reports revoked=%s', async (revoked) => {
    const b = bench(); b.fetch.mockResolvedValueOnce(ok(list([device, second]))); await b.open()
    b.fetch.mockResolvedValueOnce(ok({ revoked }))
    await b.service.revoke(device.deviceId)
    expect(b.snapshot().devices).toEqual([second])
    expect(String(b.fetch.mock.calls[1]?.[0])).toBe(`${origin}/api/connection/devices/revoke`)
    expect(b.fetch.mock.calls[1]?.[1].body).toBe(JSON.stringify({ deviceId: device.deviceId }))
    await b.service.revoke(device.deviceId)
    expect(b.fetch).toHaveBeenCalledTimes(2)
  })
  it('requires an authoritative read after uncertain revocation, without replaying it', async () => {
    const b = bench(); await b.open()
    b.fetch.mockRejectedValueOnce(new Error('reply lost'))
    await b.service.revoke(device.deviceId); await b.service.revoke(device.deviceId)
    expect(b.snapshot()).toMatchObject({ error: 'revocation-unknown', status: 'error', devices: [device] })
    b.fetch.mockResolvedValueOnce(ok(list([])))
    await b.service.refresh()
    expect(b.snapshot()).toMatchObject({ status: 'ready', error: null, devices: [] })
    expect(b.fetch.mock.calls.map(call => call[1].method)).toEqual(['GET', 'POST', 'GET'])
  })
  it('clears generation-owned data and refreshes only reads when a Host reconnects', async () => {
    const b = bench(); await b.open()
    const pending = delayed(b)
    const attempt = b.service.enroll()
    b.publish(undefined)
    expect(pending.signal()?.aborted).toBe(true)
    expect(b.snapshot()).toMatchObject({ status: 'disconnected', devices: [], enrollment: null })
    b.publish({ id: 2, host: { home: '/home', identity: { ...identity, activationId: connectionIdentitySchema.parse({ ...identity, activationId: '40000000-0000-4000-8000-000000000001' }).activationId } } })
    pending.release(ok(enrollment())); await attempt
    await vi.waitFor(() => { expect(b.snapshot().status).toBe('ready') })
    expect(b.snapshot().enrollment).toBeNull()
    expect(b.fetch.mock.calls.map(call => call[1].method)).toEqual(['GET', 'POST', 'GET'])
  })
  it('withdraws its listener and waits for owned work exactly once on disposal', async () => {
    const b = bench()
    const pending = delayed(b)
    b.service.open()
    const closing = b.service.dispose()
    expect(b.service.dispose()).toBe(closing)
    expect(b.listeners.size).toBe(0)
    expect(pending.signal()?.aborted).toBe(true)
    let settled = false
    void closing.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    pending.release(ok(list())); await closing
    b.service.start(); b.service.open(); await b.service.refresh()
    expect(b.listeners.size).toBe(0)
    expect(b.fetch).toHaveBeenCalledTimes(1)
    expect(b.snapshot().devices).toEqual([])
  })
})
