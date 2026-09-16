/** Portable enrollment response validation and credential isolation. */
import { describe, expect, it, vi } from 'vitest'
import { claimDeviceEnrollment } from '../src/client/device-access.ts'
import { connectionIdentitySchema } from '../src/host-identity-protocol.ts'
import type { RpcFetch } from '../src/client/rpc-caller.ts'

const identity = connectionIdentitySchema.parse({ version: 1, hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02' })
const deviceId = '00293014-2e9f-47ef-bc87-98fe20ebceae'
const value = { version: 1, hostId: identity.hostId, device: { deviceId, label: 'Phone', createdAt: 1 }, credential: `dsh-device-v1.${deviceId}.${'a'.repeat(43)}` }
const input = { baseUrl: 'https://paired.example', expectedHostId: identity.hostId, challenge: 'b'.repeat(43), label: 'Phone' }
const options = (fetch: RpcFetch, signal = new AbortController().signal) => ({ ...input, fetch, signal })

describe('portable device enrollment', () => {
  it('claims once with cookies omitted and redirects refused', async () => {
    const fetch = vi.fn<RpcFetch>().mockResolvedValue(Response.json({ ok: true, value }))
    expect(await claimDeviceEnrollment(options(fetch))).toEqual({ ok: true, value })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url.href).toBe('https://paired.example/api/connection/devices/claim')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json' } })
    expect(JSON.parse(init.body as string)).toEqual({ hostId: identity.hostId, challenge: input.challenge, label: 'Phone' })
  })

  it.each([
    {}, { ok: true, value: { ...value, version: 2 } }, { ok: true, value: { ...value, credential: 'invalid' } },
    { ok: true, value: { ...value, device: { ...value.device, deviceId: identity.hostId } } },
  ])('refuses invalid credential responses %#', async (body) => {
    expect(await claimDeviceEnrollment(options(async () => Response.json(body))))
      .toMatchObject({ ok: false, error: { code: 'connection/invalid-enrollment-response' } })
  })

  it('refuses another Host and propagates explicit claim rejection', async () => {
    expect(await claimDeviceEnrollment(options(async () => Response.json({ ok: true, value: { ...value, hostId: deviceId } }))))
      .toMatchObject({ ok: false, error: { code: 'connection/enrollment-host-mismatch' } })
    const failure = { ok: false, error: { code: 'connection/invalid-enrollment', message: 'refused', details: {} } }
    expect(await claimDeviceEnrollment(options(async () => Response.json(failure, { status: 401 })))).toEqual(failure)
    expect(await claimDeviceEnrollment(options(async () => Response.json(failure))))
      .toMatchObject({ ok: false, error: { code: 'connection/invalid-enrollment-response' } })
  })

  it('rejects before dispatch and after a late response when cancelled', async () => {
    const controller = new AbortController()
    const response = Promise.withResolvers<Response>()
    const fetch = vi.fn<RpcFetch>(() => response.promise)
    const pending = claimDeviceEnrollment(options(fetch, controller.signal))
    controller.abort(new Error('pairing cancelled'))
    response.resolve(Response.json({ ok: true, value }))
    await expect(pending).rejects.toThrow('pairing cancelled')
    await expect(claimDeviceEnrollment(options(fetch, controller.signal))).rejects.toThrow('pairing cancelled')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['file:///tmp/host', 'https://user:secret@host.example'])('refuses unsafe origin %s without dispatch', async (baseUrl) => {
    const fetch = vi.fn<RpcFetch>()
    await expect(claimDeviceEnrollment({ ...options(fetch), baseUrl })).rejects.toThrow('HTTP(S) origin')
    expect(fetch).not.toHaveBeenCalled()
  })
})
