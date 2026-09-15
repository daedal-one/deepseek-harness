/** Host capability wire acceptance and caller lifetime. */
import { describe, expect, it, vi } from 'vitest'
import { connectionIdentitySchema } from '@deepseek-ai/dsh-client-connection/identity'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { readHostCapabilities } from '../src/client/host-capabilities.ts'

const identity = connectionIdentitySchema.parse({
  version: 1, hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02',
})
const wireFingerprint = `typert-wire-v1:${'a'.repeat(64)}`
const capability = { wireFingerprint, semanticRevision: 1, endpoint: 'session/follow', mode: 'stream', availability: 'available' }
const snapshot = { version: 3, identity, capabilities: [capability] }
const rpc = (value: unknown): ClientConnectionRpc => ({ call: () => Promise.resolve({ ok: true, value }) })

describe('portable Host capability discovery', () => {
  it('validates all availability states on the selected carrier without retrying', async () => {
    const controller = new AbortController()
    const value = { ...snapshot, capabilities: [
      { endpoint: 'a/m', mode: 'unary', availability: 'unavailable', reason: 'service' },
      { endpoint: 'b/m', mode: 'unary', availability: 'context-required' }, capability,
    ] }
    const call = vi.fn<ClientConnectionRpc['call']>(() => Promise.resolve({ ok: true, value }))
    expect(await readHostCapabilities({ call }, identity, controller.signal)).toEqual({ ok: true, value })
    expect(call).toHaveBeenCalledExactlyOnceWith('/api', '$capabilities', {}, controller.signal)
    expect(await readHostCapabilities(rpc({ ...snapshot, capabilities: [] }), identity)).toMatchObject({ ok: true })
  })

  it.each([
    null, [], {}, { ...snapshot, version: 1 }, { ...snapshot, version: 2 }, { ...snapshot, version: 4 }, { ...snapshot, secret: 'unexpected' },
    { ...snapshot, identity: { ...identity, hostId: 'bad' } },
    ...[
      ...[null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(semanticRevision => [{ ...capability, semanticRevision }]),
      [{ ...capability, endpoint: 'a/b/c' }],
      ...[null, 1, '', 'typert-wire-v0:' + 'a'.repeat(64), 'typert-wire-v1:' + 'A'.repeat(64), 'typert-wire-v1:short'].map(wireFingerprint => [{ ...capability, wireFingerprint }]), [{ ...capability, mode: 'unknown' }],
      [{ ...capability, availability: 'unknown' }], [{ ...capability, reason: 'service' }],
      [{ ...capability, availability: 'unavailable' }],
      [{ ...capability, availability: 'unavailable', reason: 'secret' }],
      [{ ...capability, path: '/home/private' }], [capability, capability],
      [capability, { ...capability, endpoint: 'a/b' }],
    ].map(capabilities => ({ ...snapshot, capabilities })),
  ])('refuses malformed capability metadata %j', async (value) => {
    expect(await readHostCapabilities(rpc(value), identity)).toMatchObject({ ok: false, error: { code: 'gateway/invalid-capabilities' } })
  })

  it.each(['hostId', 'activationId'] as const)('refuses a different %s', async (field) => {
    const value = { ...snapshot, identity: { ...identity, [field]: '00293014-2e9f-47ef-bc87-98fe20ebceae' } }
    expect(await readHostCapabilities(rpc(value), identity)).toMatchObject({ ok: false, error: { code: 'gateway/capability-identity-mismatch' } })
  })

  it('preserves Host refusal and carrier rejection without retrying', async () => {
    const failure = { ok: false as const, error: { code: 'denied', message: 'denied', details: {} } }
    expect(await readHostCapabilities({ call: () => Promise.resolve(failure) }, identity)).toBe(failure)
    const lost = new Error('carrier lost')
    const call = vi.fn<ClientConnectionRpc['call']>(() => Promise.reject(lost))
    await expect(readHostCapabilities({ call }, identity)).rejects.toBe(lost)
    expect(call).toHaveBeenCalledOnce()
  })

  it('refuses calls and late responses after caller cancellation', async () => {
    const controller = new AbortController()
    const result = Promise.withResolvers<Awaited<ReturnType<ClientConnectionRpc['call']>>>()
    const call = vi.fn<ClientConnectionRpc['call']>(() => result.promise)
    const pending = readHostCapabilities({ call }, identity, controller.signal)
    const cancelled = new Error('generation ended')
    controller.abort(cancelled)
    result.resolve({ ok: true, value: snapshot })
    await expect(pending).rejects.toBe(cancelled)
    await expect(readHostCapabilities({ call }, identity, controller.signal)).rejects.toBe(cancelled)
    expect(call).toHaveBeenCalledExactlyOnceWith('/api', '$capabilities', {}, controller.signal)
  })
})
