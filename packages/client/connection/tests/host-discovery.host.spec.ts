/** Discovery bounds, caller lifetimes, status parsing and anonymous candidate correlation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostDiscovery } from '../src/host-discovery.ts'
import { TailscaleUnavailable, type HostDiscoveryIo } from '../src/discovery-io.ts'
import { isTailnetAddress, tailnetOriginSchema } from '../src/discovery-protocol.ts'
import { advertisement, discoveryConfig, discoveryIdentity } from './discovery-fixture.ts'

const running = { BackendState: 'Running', Self: { TailscaleIPs: ['100.64.0.1'] } }
function io(status: unknown = running): HostDiscoveryIo {
  return { readStatus: vi.fn(() => Promise.resolve(status)), probe: vi.fn(() => Promise.resolve(advertisement)) }
}
afterEach(() => { vi.useRealTimers() })

describe('Host-assisted discovery', () => {
  it.each(['100.64.0.1', '100.127.255.255', 'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:1234:5678:9abc:def0:1'])('accepts canonical tailnet address %s', (address) => {
    expect(isTailnetAddress(address)).toBe(true)
  })
  it.each(['100.63.1.1', '100.128.1.1', '100.064.1.1', '100.64.00.1', '100.64.0.256', '127.0.0.1', '169.254.169.254',
    '192.168.1.1', 'example.ts.net', '0x64400001', '100.64.0.1.evil', 'fd7a:115c:a1e1::1', 'FD7A:115c:a1e0::1',
    'fd7a:115c:a1e0:0:0:0:0:1', 'fd7a:115c:a1e0::1%en0', 'fd7a:115c:a1e0:::1', 'fd7a:115c:a1e0::1/path'])('refuses probe address %s', (address) => {
    expect(isTailnetAddress(address)).toBe(false)
  })
  it.each(['http://100.64.0.1:3081/', 'https://100.64.0.1:3081', 'http://100.64.0.1:3081/?q=a',
    'http://secret@100.64.0.1:3081', 'http://host.ts.net:3081', 'not a URL'])('refuses noncanonical origin %s', (origin) => {
    expect(tailnetOriginSchema.safeParse(origin).success).toBe(false)
  })
  it('uses configured ports, omits offline/foreign addresses and deduplicates independently of completion order', async () => {
    const operations = io({ BackendState: 'Running', Self: { TailscaleIPs: ['100.64.0.1', '100.64.0.1', '127.0.0.1'] }, Peer: {
      online: { Online: true, TailscaleIPs: ['100.64.0.2', 'fd7a:115c:a1e0::2'] },
      offline: { Online: false, TailscaleIPs: ['100.64.0.3'] }, empty: { Online: true },
    } })
    const first = Promise.withResolvers<unknown>()
    operations.probe = vi.fn<HostDiscoveryIo['probe']>(origin => origin === 'http://100.64.0.1:3081' ? first.promise : Promise.resolve(advertisement))
    const owner = new HostDiscovery(discoveryIdentity, { ...discoveryConfig, ports: [3081, 80, 3081] }, operations)
    try {
      const scan = owner.scan(new AbortController().signal)
      await vi.waitFor(() => { expect(operations.probe).toHaveBeenCalledTimes(6) })
      first.resolve(advertisement)
      const result = await scan
      expect(result).toMatchObject({ status: 'ready', truncated: false, candidates: [{ ...advertisement, origin: 'http://[fd7a:115c:a1e0::2]:3081' }] })
      expect(operations.probe).not.toHaveBeenCalledWith(expect.stringContaining('100.64.0.3'), expect.anything())
    } finally { first.resolve(advertisement); await owner.dispose() }
  })
  it('limits probe count and concurrency and ignores invalid or unreachable advertisements', async () => {
    const operations = io({ ...running, Peer: { p: { Online: true, TailscaleIPs: ['100.64.0.2', '100.64.0.3', '100.64.0.4'] } } })
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    let active = 0; let peak = 0
    operations.probe = vi.fn<HostDiscoveryIo['probe']>(async (origin) => {
      active++; peak = Math.max(peak, active); entered.resolve(undefined); await release.promise; active--
      if (origin.includes('.1:')) throw new Error('Offline')
      return { ...advertisement, enrollment: 'forbidden extra field' }
    })
    const owner = new HostDiscovery(discoveryIdentity, { ...discoveryConfig, maxProbes: 3 }, operations)
    try {
      const scan = owner.scan(new AbortController().signal); await entered.promise
      expect(operations.probe).toHaveBeenCalledTimes(2); release.resolve(undefined)
      expect(await scan).toMatchObject({ status: 'ready', truncated: true, candidates: [] })
      expect(operations.probe).toHaveBeenCalledTimes(3); expect(peak).toBe(2); expect(active).toBe(0)
    } finally { release.resolve(undefined); await owner.dispose() }
  })
  it('keeps different Host ids even when labels match and sorts by identity', async () => {
    const operations = io({ ...running, Peer: { p: { Online: true, TailscaleIPs: ['100.64.0.2'] } } })
    operations.probe = vi.fn<HostDiscoveryIo['probe']>(origin => Promise.resolve(origin.includes('.1:') ? advertisement : { ...advertisement,
      identity: { ...discoveryIdentity, hostId: '16e99520-f2d3-4874-84b5-07c5ef24775d' } }))
    const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations)
    try { expect((await owner.scan(new AbortController().signal)).candidates.map(candidate => candidate.identity.hostId)).toEqual([
      '16e99520-f2d3-4874-84b5-07c5ef24775d', discoveryIdentity.hostId,
    ]) } finally { await owner.dispose() }
  })
  it.each([
    [{ BackendState: 'Stopped' }, 'tailscale-disconnected'], [{ BackendState: 'NeedsLogin' }, 'tailscale-disconnected'],
    [{ BackendState: 'Running', Peer: null }, 'ready'], [null, 'scan-failed'], [{}, 'scan-failed'],
    [{ ...running, Peer: { p: { Online: 'yes' } } }, 'scan-failed'],
  ])('reports status without exposing status JSON: %j', async (status, expected) => {
    const operations = io(status); const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations)
    try {
      expect(await owner.scan(new AbortController().signal)).toEqual({
        version: 1, host: discoveryIdentity, status: expected, candidates: [], truncated: false,
      })
      expect(operations.probe).not.toHaveBeenCalled()
    } finally { await owner.dispose() }
  })
  it.each([[new TailscaleUnavailable(), 'tailscale-unavailable'], [new Error('private details'), 'scan-failed']])('reports fixed external failure categories', async (failure, expected) => {
    const operations = io(); operations.readStatus = () => Promise.reject(failure)
    const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations)
    try { expect(await owner.scan(new AbortController().signal)).toMatchObject({ status: expected, candidates: [] }) }
    finally { await owner.dispose() }
  })
  it('coalesces callers and preserves a scan when only one caller cancels', async () => {
    const entered = Promise.withResolvers<AbortSignal>(); const release = Promise.withResolvers<unknown>()
    const operations = io(); operations.readStatus = vi.fn<HostDiscoveryIo['readStatus']>((signal) => { entered.resolve(signal); return release.promise })
    const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations)
    const first = new AbortController(); const second = new AbortController()
    try {
      const a = owner.scan(first.signal); const b = owner.scan(second.signal); const signal = await entered.promise
      const rejected = expect(a).rejects.toThrow('caller gone'); first.abort(new Error('caller gone')); await rejected
      expect(signal.aborted).toBe(false); release.resolve(running)
      expect(await b).toMatchObject({ status: 'ready' }); expect(operations.readStatus).toHaveBeenCalledTimes(1)
    } finally { release.resolve(running); await owner.dispose() }
  })
  it('waits for cancelled work before replacement and disposal prevents late publication', async () => {
    const entered = Promise.withResolvers<AbortSignal>(); const release = Promise.withResolvers<unknown>()
    const operations = io(); operations.readStatus = vi.fn<HostDiscoveryIo['readStatus']>((signal) => { entered.resolve(signal); return release.promise })
    const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations)
    const caller = new AbortController()
    try {
      const first = owner.scan(caller.signal); const signal = await entered.promise
      const rejected = expect(first).rejects.toThrow('cancelled'); caller.abort(new Error('cancelled')); await rejected
      expect(signal.aborted).toBe(true)
      const next = owner.scan(new AbortController().signal)
      const nextRejected = expect(next).rejects.toThrow('disposed')
      let disposed = false; const disposal = owner.dispose().then(() => { disposed = true })
      await Promise.resolve(undefined); expect(disposed).toBe(false); expect(operations.readStatus).toHaveBeenCalledTimes(1)
      release.resolve(running); await disposal; await nextRejected
      expect(operations.probe).not.toHaveBeenCalled()
      await expect(owner.scan(new AbortController().signal)).rejects.toThrow('disposed')
    } finally { release.resolve(running); await owner.dispose() }
  })
  it('starts a fresh scan after the last cancelled caller has quiesced', async () => {
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<unknown>()
    const operations = io()
    operations.readStatus = vi.fn<HostDiscoveryIo['readStatus']>().mockImplementationOnce(() => { entered.resolve(undefined); return release.promise }).mockResolvedValue(running)
    const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations); const caller = new AbortController()
    try {
      const first = owner.scan(caller.signal); await entered.promise
      const rejected = expect(first).rejects.toThrow(); caller.abort(); await rejected
      const next = owner.scan(new AbortController().signal); release.resolve(running)
      expect(await next).toMatchObject({ status: 'ready' }); expect(operations.readStatus).toHaveBeenCalledTimes(2)
    } finally { release.resolve(running); await owner.dispose() }
  })
  it('expires completed cache entries and bounds a stalled scan without caching its timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const operations = io(); const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations)
    try {
      const signal = new AbortController().signal; const first = await owner.scan(signal)
      expect(await owner.scan(signal)).toBe(first); expect(operations.readStatus).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(discoveryConfig.cacheTtlMs)
      operations.readStatus = vi.fn<HostDiscoveryIo['readStatus']>(signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('Scan cancelled')) }, { once: true })
      }))
      const timed = owner.scan(signal); await vi.advanceTimersByTimeAsync(discoveryConfig.scanTimeoutMs)
      expect(await timed).toMatchObject({ status: 'scan-failed' })
      operations.readStatus = vi.fn<HostDiscoveryIo['readStatus']>(() => Promise.resolve(running))
      expect(await owner.scan(signal)).toMatchObject({ status: 'ready' }); expect(operations.readStatus).toHaveBeenCalledTimes(1)
    } finally { await owner.dispose() }
  })
  it('disposes pending probes before settling and refuses pre-cancelled calls', async () => {
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<unknown>()
    const operations = io(); operations.probe = () => { entered.resolve(undefined); return release.promise }
    const owner = new HostDiscovery(discoveryIdentity, discoveryConfig, operations)
    try {
      const abort = new AbortController(); abort.abort(new Error('before dispatch'))
      await expect(owner.scan(abort.signal)).rejects.toThrow('before dispatch'); expect(operations.readStatus).not.toHaveBeenCalled()
      const scan = owner.scan(new AbortController().signal); const rejected = expect(scan).rejects.toThrow('disposed')
      await entered.promise; const disposal = owner.dispose(); release.resolve(advertisement); await disposal; await rejected
    } finally { release.resolve(advertisement); await owner.dispose() }
  })
  it('rejects invalid deployment limits before scanning', () => {
    for (const config of [{ ...discoveryConfig, maxProbes: 257 }, { ...discoveryConfig, ports: [] },
      { ...discoveryConfig, label: ' ' }, { ...discoveryConfig, statusTimeoutMs: 0 }]) {
      expect(() => new HostDiscovery(discoveryIdentity, config, io())).toThrow()
    }
  })
})
