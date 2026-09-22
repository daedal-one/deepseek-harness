// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { BrowserDeviceAdministration } from '@deepseek-ai/dsh-client-connection/src/client/device-administration.ts'
import { connectionIdentitySchema, type RpcFetch } from '@deepseek-ai/dsh-client-connection/client'
import { DeviceSettings, type DeviceSettingsProps, type DeviceSettingsInjected } from '../src/client/DeviceSettings.tsx'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

const identity = connectionIdentitySchema.parse({ version: 1, hostId: '10000000-0000-4000-8000-000000000001', activationId: '10000000-0000-4000-8000-000000000002' })
const device = { deviceId: '20000000-0000-4000-8000-000000000001', label: 'Carlo’s iPhone', createdAt: 1 }
const list = (devices: unknown[] = []) => ({ version: 1, hostId: identity.hostId, devices })
const ok = (value: unknown) => Response.json({ ok: true, value })
const disposals: Array<() => Promise<unknown>> = []
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); for (const dispose of disposals.splice(0).reverse()) await dispose() })
const unused = (() => { throw new Error('Unused Settings framework hook') }) as never
const kit = { useSessions: unused, useSessionPendingInteraction: unused, usePanelInfo: unused,
  useResource: unused, useWorkspaces: unused, close: unused }

function bench(origin: string | null = 'https://host.example.test:3081', connected = true) {
  const generation = { id: 1, host: { home: '/home', identity } }
  const fetch = vi.fn<RpcFetch>().mockImplementation(() => Promise.resolve(ok(list())))
  const service = new BrowserDeviceAdministration({ origin: origin ?? undefined, fetch,
    generation: { getSnapshot: () => connected ? generation : undefined, subscribe: () => () => {} },
  })
  disposals.push(() => service.dispose()); service.start()
  const props: DeviceSettingsProps = { ...kit,
    openSection: () => { service.open() }, closeSection: () => { service.close() },
    refresh: () => service.refresh(), enroll: () => service.enroll(),
    hide: () => { service.hideEnrollment() }, revoke: id => service.revoke(id),
    useAdministration: bindSnapshotSelector(service.state), t: key => (en as Record<string, string>)[key] ?? key,
  }
  return { service, fetch, props }
}
const ready = async () => { await waitFor(() => { expect((screen.getByRole('button', { name: en.create })).hasAttribute('disabled')).toBe(false) }) }
const click = (name: string) => { fireEvent.click(screen.getByRole('button', { name })) }

describe('Devices settings', () => {
  it.each(['unavailable', 'disconnected'] as const)('presents the %s state without mutation controls', (state) => {
    const b = state === 'unavailable' ? bench(null) : bench(undefined, false)
    render(<DeviceSettings {...b.props} />)
    expect(screen.getByText(en[state])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.create })).toBeNull()
    expect(b.fetch).not.toHaveBeenCalled()
  })
  it('presents the empty owner workflow and removes its data when unmounted', async () => {
    const b = bench(); const view = render(<DeviceSettings {...b.props} />); await ready()
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect([...view.container.querySelectorAll('h2,h3,p,button')].map(node => node.textContent)).toMatchSnapshot()
    view.unmount()
    expect(b.service.state.getSnapshot()).toMatchObject({ devices: [], enrollment: null, status: 'idle' })
  })
  it('warns that a loopback address cannot pair a physical phone', async () => {
    const b = bench('http://127.0.0.1:12345'); render(<DeviceSettings {...b.props} />); await ready()
    expect(screen.getByRole('note').textContent).toBe(en.loopback)
  })
  it('renders a real QR only after the gesture and removes it when hidden', async () => {
    const b = bench(); const view = render(<DeviceSettings {...b.props} />); await ready()
    expect(view.container.querySelector('svg')).toBeNull()
    b.fetch.mockResolvedValueOnce(ok({ version: 1, hostId: identity.hostId, challenge: 'a'.repeat(43), expiresAt: Date.now() + 60_000 }))
    click(en.create)
    await screen.findByTitle(en.qrTitle)
    expect(view.container.querySelector('svg path')).toBeTruthy()
    expect(screen.getByText(en.hideHint)).toBeTruthy()
    click(en.hide)
    expect(screen.queryByTitle(en.qrTitle)).toBeNull()
    expect(b.service.state.getSnapshot().enrollment).toBeNull()
  })
  it.each([true, false])('copies the exact QR envelope only on demand and reports accepted=%s', async (accepted) => {
    const writeText = vi.fn<(text: string) => Promise<void>>()
    if (accepted) writeText.mockResolvedValue(undefined)
    else writeText.mockRejectedValue(new Error('Clipboard refused'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const b = bench(); const view = render(<DeviceSettings {...b.props} />); await ready()
    const enrollment = { version: 1, hostId: identity.hostId, challenge: 'c'.repeat(43), expiresAt: Date.now() + 60_000 }
    b.fetch.mockResolvedValueOnce(ok(enrollment)); click(en.create); await screen.findByTitle(en.qrTitle)
    expect(writeText).not.toHaveBeenCalled()
    click(en.copy)
    await screen.findByText(accepted ? en.copied : en.copyFailed)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ version: 1, origin: 'https://host.example.test:3081', enrollment }))
    expect(view.container.textContent).not.toContain(enrollment.challenge)
    if (!accepted) expect(screen.queryByText(en.copied)).toBeNull()
    click(en.hide); expect(screen.queryByRole('button', { name: en.copy })).toBeNull()
    expect(writeText).toHaveBeenCalledOnce()
  })

  it('requires a separate confirmation and allows cancelling before revocation', async () => {
    const b = bench(); b.fetch.mockResolvedValueOnce(ok(list([device])))
    render(<DeviceSettings {...b.props} />); await ready()
    click(en.revoke)
    expect(screen.getByRole('group', { name: en.confirmation }).textContent).toContain(device.label)
    expect(b.fetch).toHaveBeenCalledTimes(1)
    click(en.cancel)
    expect(screen.queryByRole('group', { name: en.confirmation })).toBeNull()
    expect(b.fetch).toHaveBeenCalledTimes(1)
    click(en.revoke); b.fetch.mockResolvedValueOnce(ok({ revoked: true })); click(en.confirmRevoke)
    await screen.findByText(en.empty)
    expect(screen.queryByText(device.label)).toBeNull()
    expect(b.fetch.mock.calls[1]?.[1].body).toBe(JSON.stringify({ deviceId: device.deviceId }))
  })
  it('keeps an uncertain revocation visible and disables mutations until refresh', async () => {
    const b = bench(); b.fetch.mockResolvedValueOnce(ok(list([device])))
    render(<DeviceSettings {...b.props} />); await ready()
    click(en.revoke); b.fetch.mockRejectedValueOnce(new Error('response lost')); click(en.confirmRevoke)
    expect((await screen.findByRole('alert')).textContent).toBe(en['error.revocation-unknown'])
    expect((screen.getByRole('button', { name: en.revoke })).hasAttribute('disabled')).toBe(true)
    expect((screen.getByRole('button', { name: en.create })).hasAttribute('disabled')).toBe(true)
    click(en.refresh)
    await screen.findByText(en.empty)
    expect(b.fetch.mock.calls.map(call => call[1].method)).toEqual(['GET', 'POST', 'GET'])
  })
  it('displays owner sign-in failure without presenting bearer administration', async () => {
    const b = bench(); b.fetch.mockResolvedValueOnce(new Response(null, { status: 403 }))
    render(<DeviceSettings {...b.props} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en['error.owner-required'])
    expect((screen.getByRole('button', { name: en.create })).hasAttribute('disabled')).toBe(true)
  })
  it('erases the QR and metadata when the section closes, retaining the shell close callback', async () => {
    const b = bench(); const shellClose = vi.fn()
    const view = render(<DeviceSettings {...b.props} close={shellClose} />); await ready()
    b.fetch.mockResolvedValueOnce(ok({ version: 1, hostId: identity.hostId, challenge: 'b'.repeat(43), expiresAt: Date.now() + 60_000 }))
    click(en.create); await screen.findByTitle(en.qrTitle)
    view.unmount()
    expect(b.service.state.getSnapshot().enrollment).toBeNull()
    expect(shellClose).not.toHaveBeenCalled()
  })
})

describe('Devices registration', () => {
  it('waits for its slot, makes no activation request and withdraws registrations on disposal', async () => {
    expect(hostApply).not.toThrow()
    const b = bench(); const ctx = new Context(); disposals.push(() => ctx.fiber.dispose())
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx); locale.setLocale('en'); ctx.provide('locale', locale)
    ctx.provide('connectionDevices', b.service)
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(0)
    const declare = () => slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    const remove = declare()
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(DeviceSettings)
    expect(resolveSlotLabel(entry.options.label)).toBe('Devices')
    expect(b.fetch).not.toHaveBeenCalled()
    const values = (entry.inject as unknown as () => DeviceSettingsInjected)()
    expect(values).not.toHaveProperty('close')
    expect(values.hooks.administration).toBe(b.service.state)
    await act(async () => { values.openSection(); await values.refresh() })
    await vi.waitFor(() => { expect(b.service.state.getSnapshot().status).toBe('ready') })
    b.fetch.mockResolvedValueOnce(ok({ version: 1, hostId: identity.hostId, challenge: 'c'.repeat(43), expiresAt: Date.now() + 60_000 }))
    await values.enroll()
    expect(b.service.state.getSnapshot().enrollment).not.toBeNull()
    values.hide()
    expect(b.service.state.getSnapshot().enrollment).toBeNull()
    b.fetch.mockResolvedValueOnce(ok(list([device])))
    await values.refresh()
    b.fetch.mockResolvedValueOnce(ok({ revoked: true }))
    await values.revoke(b.service.state.getSnapshot().devices[0]!.deviceId)
    expect(b.service.state.getSnapshot().devices).toEqual([])
    values.closeSection()
    remove(); expect(slots.entries('settings.section')).toHaveLength(0)
    declare(); await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(() => locale.register('settings.devices', 'en', {})).not.toThrow()
  })
})
