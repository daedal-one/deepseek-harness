/** Portable discovery validates metadata without granting access or retrying a scan. */
import { describe, expect, it, vi } from 'vitest'
import { discoverHosts } from '../src/client/host-discovery.ts'
import type { ClientConnectionRpc, ConnectionRpcResult } from '../src/rpc.ts'
import { advertisement, discoveryIdentity } from './discovery-fixture.ts'

const result = { version: 1, host: discoveryIdentity, status: 'ready', truncated: false,
  candidates: [{ ...advertisement, origin: 'http://100.64.0.1:3081' }] }
describe('portable Host discovery', () => {
  it('sends only an empty request to the paired Host and forwards cancellation', async () => {
    const controller = new AbortController()
    const call = vi.fn<ClientConnectionRpc['call']>(() => Promise.resolve({ ok: true, value: result }))
    expect(await discoverHosts({ call }, discoveryIdentity.hostId, controller.signal)).toEqual({ ok: true, value: result })
    expect(call).toHaveBeenCalledExactlyOnceWith('/api', 'connection/discovery', {}, controller.signal)
  })
  it.each([null, [], {}, { ...result, version: 2 }, { ...result, secret: 'extra' },
    { ...result, host: { ...discoveryIdentity, hostId: '16e99520-f2d3-4874-84b5-07c5ef24775d' } },
    { ...result, status: 'tailscale-unavailable' }, { ...result, candidates: [...result.candidates, ...result.candidates] },
    { ...result, candidates: [{ ...result.candidates[0], origin: 'http://127.0.0.1:3081' }] },
    { ...result, candidates: [{ ...result.candidates[0], label: '\n' }] },
    { ...result, candidates: [{ ...result.candidates[0], label: 'a\nb' }] },
  ])('rejects malformed or foreign assisting-Host responses %j', async (value) => {
    expect(await discoverHosts({ call: () => Promise.resolve({ ok: true, value }) }, discoveryIdentity.hostId))
      .toMatchObject({ ok: false, error: { code: 'connection/invalid-discovery' } })
  })
  it('preserves optional-endpoint failures and transport rejection without a retry', async () => {
    const failure: ConnectionRpcResult<never> = { ok: false, error: { code: 'missing', message: 'Unavailable', details: {} } }
    expect(await discoverHosts({ call: () => Promise.resolve(failure) }, discoveryIdentity.hostId)).toBe(failure)
    const call = vi.fn<ClientConnectionRpc['call']>(() => Promise.reject(new Error('lost')))
    await expect(discoverHosts({ call }, discoveryIdentity.hostId)).rejects.toThrow('lost'); expect(call).toHaveBeenCalledTimes(1)
  })
  it('rejects cancellation before dispatch and after a late decoded response', async () => {
    const controller = new AbortController(); controller.abort(new Error('gone'))
    const call = vi.fn<ClientConnectionRpc['call']>(() => Promise.resolve({ ok: true, value: result }))
    await expect(discoverHosts({ call }, discoveryIdentity.hostId, controller.signal)).rejects.toThrow('gone')
    expect(call).not.toHaveBeenCalled()
    const late = new AbortController()
    await expect(discoverHosts({ call: () => { late.abort(new Error('late')); return Promise.resolve({ ok: true, value: result }) } },
      discoveryIdentity.hostId, late.signal)).rejects.toThrow('late')
  })
})
