/** Device enrollment persistence, replay refusal and independent revocation lifetimes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceRoutes } from '../src/device-routes.ts'
import { DEVICE_ACCESS_PATHS } from '../src/device-protocol.ts'
import { DeviceAccess, DeviceAccessError, DEVICE_ACCESS_KEY } from '../src/device-access.ts'
import { connectionIdentitySchema } from '../src/host-identity-protocol.ts'
import { KeyedCredentials } from './browser-credentials.ts'
import type { ConnectionDeviceGrant } from '../src/device-protocol.ts'

const identity = connectionIdentitySchema.parse({ version: 1, hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02' })
const config = { enrollmentTtlMs: 1000, maxPendingEnrollments: 2, maxDevices: 2 }
const owners: DeviceAccess[] = []
afterEach(async () => { await Promise.all(owners.splice(0).map(owner => owner.dispose())); vi.useRealTimers() })
async function create(credentials = new KeyedCredentials(), limits = config) {
  const access = await DeviceAccess.create(credentials, identity, limits)
  owners.push(access)
  return { access, credentials }
}
async function grant(access: DeviceAccess, label = 'Phone'): Promise<ConnectionDeviceGrant> {
  const enrollment = await access.enroll()
  return access.claim({ hostId: enrollment.hostId, challenge: enrollment.challenge, label })
}

describe('Connection device grants', () => {
  it('persists only digests and public metadata and survives a new Connection owner', async () => {
    const { access, credentials } = await create()
    const enrollment = await access.enroll()
    const request = { hostId: identity.hostId, challenge: enrollment.challenge, label: 'Phone' }
    const outcomes = await Promise.allSettled([access.claim(request), access.claim(request)])
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'connection/invalid-enrollment' } })
    const first = outcomes[0]
    if (first?.status !== 'fulfilled') throw new Error('first claim did not succeed')
    const issued = first.value
    expect(issued.device.label).toBe('Phone')
    const stored = JSON.stringify(credentials.records.get(DEVICE_ACCESS_KEY))
    expect(stored).not.toContain(issued.credential)
    expect(stored).not.toContain(enrollment.challenge)
    expect(await access.list()).toEqual([issued.device])
    const { access: next } = await create(credentials)
    const lease = await next.authorize(issued.credential)
    expect(lease?.signal.aborted).toBe(false)
    lease?.dispose()
    await expect(next.claim(request)).rejects.toMatchObject({ code: 'connection/invalid-enrollment' })
  })

  it('refuses wrong Host claims, expired challenges and exhausted enrollment capacity', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
    const { access } = await create(undefined, { ...config, maxPendingEnrollments: 1 })
    const enrollment = await access.enroll()
    await expect(access.enroll()).rejects.toMatchObject({ code: 'connection/enrollment-limit' })
    await expect(access.claim({ hostId: connectionIdentitySchema.parse({ ...identity, hostId: '00293014-2e9f-47ef-bc87-98fe20ebceae' }).hostId,
      challenge: enrollment.challenge, label: 'Phone' })).rejects.toMatchObject({ code: 'connection/invalid-enrollment' })
    vi.advanceTimersByTime(1000)
    await expect(access.claim({ hostId: identity.hostId, challenge: enrollment.challenge, label: 'Phone' }))
      .rejects.toMatchObject({ code: 'connection/invalid-enrollment' })
    const expired = await access.enroll()
    vi.advanceTimersByTime(1000)
    expect((await access.enroll()).challenge).not.toBe(expired.challenge)
  })

  it('enforces the device limit and consumes claims whose persistence fails', async () => {
    const { access, credentials } = await create(undefined, { ...config, maxDevices: 1 })
    const first = await grant(access)
    const blocked = await access.enroll()
    const claim = { hostId: identity.hostId, challenge: blocked.challenge, label: 'Tablet' }
    await expect(access.claim(claim)).rejects.toMatchObject({ code: 'connection/device-limit' })
    await expect(access.claim(claim)).rejects.toMatchObject({ code: 'connection/invalid-enrollment' })
    expect(await access.revoke(first.device.deviceId)).toBe(true)
    const failed = await access.enroll()
    vi.spyOn(credentials, 'modifyRecord').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(access.claim({ ...claim, challenge: failed.challenge })).rejects.toThrow('storage unavailable')
    await expect(access.claim({ ...claim, challenge: failed.challenge })).rejects.toMatchObject({ code: 'connection/invalid-enrollment' })
    expect(await access.list()).toEqual([])
  })

  it('revokes only the selected device after persistence and rejects future bearer requests', async () => {
    const { access, credentials } = await create()
    const first = await grant(access)
    const second = await grant(access, 'Tablet')
    const a = await access.authorize(first.credential)
    const b = await access.authorize(second.credential)
    const released = await access.authorize(first.credential)
    released?.dispose()
    vi.spyOn(credentials, 'modifyRecord').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(access.revoke(first.device.deviceId)).rejects.toThrow('storage unavailable')
    expect(a?.signal.aborted).toBe(false)
    expect(await access.revoke(first.device.deviceId)).toBe(true)
    expect(a?.signal.aborted).toBe(true)
    expect(b?.signal.aborted).toBe(false)
    expect(released?.signal.aborted).toBe(false)
    expect(await access.authorize(first.credential)).toBeUndefined()
    expect(await access.revoke(first.device.deviceId)).toBe(false)
    expect(await access.authorize(second.credential.slice(0, -1) + (second.credential.endsWith('a') ? 'b' : 'a'))).toBeUndefined()
    expect(await access.authorize('invalid')).toBeUndefined()
    expect(await access.list()).toEqual([second.device])
  })

  it('reconciles removed and malformed records without exposing active credentials', async () => {
    const { access, credentials } = await create()
    const issued = await grant(access)
    const active = await access.authorize(issued.credential)
    credentials.records.delete(DEVICE_ACCESS_KEY)
    await access.refresh()
    expect(active?.signal.aborted).toBe(true)
    const second = await grant(access)
    const next = await access.authorize(second.credential)
    credentials.records.set(DEVICE_ACCESS_KEY, { kind: 'grant', payload: { version: 2 } })
    await expect(access.refresh()).rejects.toMatchObject({ code: 'connection/invalid-device-record' })
    expect(next?.signal.aborted).toBe(true)
    await expect(access.authorize(second.credential)).rejects.toMatchObject({ code: 'connection/invalid-device-record' })
    await expect(DeviceAccess.create(credentials, identity, config)).rejects.toMatchObject({ code: 'connection/invalid-device-record' })
  })

  it('refuses uncommitted grants and revocations and rejects non-grant persisted records', async () => {
    const { access, credentials } = await create()
    const issued = await grant(access)
    vi.spyOn(credentials, 'modifyRecord').mockImplementationOnce(key => credentials.readRecord(key))
    await expect(grant(access, 'Lost write')).rejects.toMatchObject({ code: 'connection/device-write-failed' })
    vi.spyOn(credentials, 'modifyRecord').mockImplementationOnce(key => credentials.readRecord(key))
    await expect(access.revoke(issued.device.deviceId)).rejects.toMatchObject({ code: 'connection/device-write-failed' })
    const active = await access.authorize(issued.credential)
    expect(active).toBeDefined()
    credentials.records.set(DEVICE_ACCESS_KEY, { kind: 'api-key' })
    await expect(access.revoke(issued.device.deviceId)).rejects.toMatchObject({ code: 'connection/invalid-device-record' })
    expect(active?.signal.aborted).toBe(true)
  })

  it('contains route failures, rejects cancelled claims and refuses bearer administration even with an owner cookie', async () => {
    const { access } = await create()
    const routes = deviceRoutes(access, identity, request => request.headers.get('cookie') === 'owner' ? undefined : 401)
    const request = (path: string, body?: unknown, bearer = false, signal?: AbortSignal) => new Request(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { cookie: 'owner', 'content-type': 'application/json',
        ...bearer ? { authorization: 'Bearer supplied' } : {} },
      ...body === undefined ? {} : { body: JSON.stringify(body) }, ...signal === undefined ? {} : { signal },
    })
    const post = routes.find(route => route.path === DEVICE_ACCESS_PATHS.enroll)!
    const list = routes.find(route => route.path === DEVICE_ACCESS_PATHS.list)!
    expect((await post.fetch(request(post.path, {}, true))).status).toBe(401)
    expect((await list.fetch(request(list.path, undefined, true))).status).toBe(401)
    const controller = new AbortController(); controller.abort()
    const claim = routes.find(route => route.path === DEVICE_ACCESS_PATHS.claim)!
    expect((await claim.fetch(request(claim.path, { hostId: identity.hostId, challenge: 'a'.repeat(43), label: 'Phone' }, false, controller.signal))).status).toBe(401)
    vi.spyOn(access, 'enroll').mockRejectedValueOnce(new Error('private storage failure'))
    const failed = await post.fetch(request(post.path, {}))
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('private storage failure')
    for (const error of [new DeviceAccessError(500, 'connection/invalid-device-record'), new Error('private storage failure')]) {
      vi.spyOn(access, 'list').mockRejectedValueOnce(error)
      const response = await list.fetch(request(list.path))
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('private storage failure')
    }
  })

  it('closes admission while a claim is persisting and waits for its write to settle', async () => {
    const { access, credentials } = await create()
    const enrollment = await access.enroll()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const modify = credentials.modifyRecord.bind(credentials)
    vi.spyOn(credentials, 'modifyRecord').mockImplementationOnce(async (key, mutate) => {
      started.resolve(undefined); await release.promise
      return modify(key, mutate)
    })
    const pending = access.claim({ hostId: identity.hostId, challenge: enrollment.challenge, label: 'Phone' })
    const refused = expect(pending).rejects.toMatchObject({ code: 'connection/device-access-closed' })
    await started.promise
    const disposing = access.dispose()
    const rejected = expect(access.enroll()).rejects.toMatchObject({ code: 'connection/device-access-closed' })
    release.resolve(undefined)
    await Promise.all([disposing, refused, rejected])
    await access.refresh()
  })
})
