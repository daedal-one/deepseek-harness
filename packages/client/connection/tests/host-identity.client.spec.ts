/** Identity wire validation and transport lifetime propagation. */
import { describe, expect, it, vi } from 'vitest'
import { readHostIdentity } from '../src/client/host-identity.ts'
import type { ClientConnectionRpc, ConnectionRpcResult } from '../src/rpc.ts'

const identity = {
  version: 1,
  hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d',
  activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02',
}
function rpc(value: unknown): ClientConnectionRpc {
  return { call: () => Promise.resolve({ ok: true, value }) }
}

describe('portable Host identity reads', () => {
  it('validates identity and forwards the selected carrier lifetime without retries', async () => {
    const controller = new AbortController()
    const call = vi.fn<ClientConnectionRpc['call']>(() => Promise.resolve({ ok: true, value: identity }))
    expect(await readHostIdentity({ call }, controller.signal)).toEqual({ ok: true, value: identity })
    expect(call).toHaveBeenCalledExactlyOnceWith('/api', 'connection/identity', {}, controller.signal)
  })

  it.each([null, [], {}, { ...identity, version: 2 }, { ...identity, hostId: 'bad' },
    { ...identity, activationId: null }, { ...identity, secret: 'unexpected' }])('refuses malformed identity %j', async (value) => {
    expect(await readHostIdentity(rpc(value))).toMatchObject({ ok: false, error: { code: 'connection/invalid-identity' } })
  })

  it('preserves Host failures and rejected or aborted transport outcomes', async () => {
    const result: ConnectionRpcResult<never> = { ok: false, error: { code: 'denied', message: 'denied', details: {} } }
    expect(await readHostIdentity({ call: () => Promise.resolve(result) })).toBe(result)
    const failure = new Error('connection lost')
    const call = vi.fn<ClientConnectionRpc['call']>(() => Promise.reject(failure))
    await expect(readHostIdentity({ call })).rejects.toBe(failure)
    expect(call).toHaveBeenCalledTimes(1)
    const controller = new AbortController()
    const cancelled = readHostIdentity({ call: (_channel, _endpoint, _payload, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => {
        const reason: unknown = signal!.reason
        reject(reason instanceof Error ? reason : new Error('abort reason must be an Error'))
      }, { once: true })
    }) }, controller.signal)
    controller.abort(failure)
    await expect(cancelled).rejects.toBe(failure)
  })
})
