import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, connectionIdentitySchema, type ConnectionHandle } from '../src/client/index.ts'
const identity = connectionIdentitySchema.parse({ version: 1, hostId: '10000000-0000-4000-8000-000000000001', activationId: '10000000-0000-4000-8000-000000000002' })
afterEach(() => { vi.unstubAllGlobals() })

describe('browser administration mounting', () => {
  it.each(['fixture', 'private', 'absent'] as const)('keeps %s page inputs outside cookie administration', async (mode) => {
    if (mode !== 'absent') vi.stubGlobal('location', new URL(`https://host.example.test/${mode === 'fixture' ? '?fixture=1' : ''}`))
    if (mode === 'private') vi.stubGlobal('__DSH_TRANSPORT__', { fetch: vi.fn() })
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const ctx = new Context()
    try {
      await ctx.plugin({ apply }).await()
      ctx.connectionDevices.open()
      await ctx.connectionDevices.refresh()
      expect(ctx.connectionDevices.state.getSnapshot().status).toBe('unavailable')
      expect(fetch).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
  it('uses the authenticated page origin and erases QR material when the page becomes hidden', async () => {
    vi.stubGlobal('location', new URL('https://host.example.test:3081/'))
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const off = vi.spyOn(document, 'removeEventListener'); vi.stubGlobal('document', document)
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, value: { version: 1, hostId: identity.hostId, devices: [] } }))
    vi.stubGlobal('fetch', fetch)
    const ctx = new Context()
    let stop: (() => void) | undefined
    try {
      await ctx.plugin({ apply }).await()
      const connection = ctx.get('connection') as ConnectionHandle
      connection.registerGenerationSource((signal, ready) => new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true }); ready({ home: '/home', identity })
      }))
      const loop = connection.start({}); stop = () => { loop.stop() }
      await vi.waitFor(() => { expect(connection.generation.getSnapshot()?.host.identity).toEqual(identity) })
      expect(fetch).not.toHaveBeenCalled()
      ctx.connectionDevices.open()
      await vi.waitFor(() => { expect(ctx.connectionDevices.state.getSnapshot().status).toBe('ready') })
      fetch.mockResolvedValueOnce(Response.json({ ok: true, value: { version: 1, hostId: identity.hostId, challenge: 'a'.repeat(43), expiresAt: Date.now() + 60_000 } }))
      await ctx.connectionDevices.enroll()
      expect(ctx.connectionDevices.state.getSnapshot().enrollment).not.toBeNull()
      document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))
      expect(ctx.connectionDevices.state.getSnapshot().enrollment).toBeNull()
      expect(String(fetch.mock.calls[0]?.[0])).toBe('https://host.example.test:3081/api/connection/devices')
    } finally { stop?.(); await ctx.fiber.dispose() }
    expect(off).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
