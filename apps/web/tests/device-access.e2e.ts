/** Browser-owner enrollment and public device admission through the shipped Web composition. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  claimDeviceEnrollment, connectionDeviceEnrollmentSchema, createConnectionRpc, readHostIdentity, RpcId,
} from '@deepseek-ai/dsh-client-connection/client/portable'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { EN_BROWSER_LOCALE } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/device-access', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: browser-owned device access', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  const lifetime = new AbortController()
  let starting: Promise<void> | undefined

  beforeAll(() => {
    starting = (async () => {
      scaffold = await launchWebScaffold({})
      lifetime.signal.throwIfAborted()
      browser = await chromium.launch()
      lifetime.signal.throwIfAborted()
      page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: EN_BROWSER_LOCALE })
    })()
    return starting
  })
  afterAll(async () => {
    lifetime.abort()
    try { await starting } catch { /* beforeAll reports the startup failure. */ }
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('pairs from an owner-created QR, confirms revocation and refuses the same device afterwards', async () => {
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.getByRole('button', { name: 'Devices', exact: true }).click()
    const section = dialog.getByRole('region', { name: 'Devices', exact: true })
    await section.getByText('No devices are enrolled.', { exact: true }).waitFor()
    expect(await section.locator('svg').count()).toBe(0)

    // Observe the real owner response; never replace its authorization or persistence path.
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/connection/devices/enroll'),
      section.getByRole('button', { name: 'Create pairing QR', exact: true }).click(),
    ])
    expect(response.ok()).toBe(true)
    const body = await response.json() as { value?: unknown }
    const parsed = connectionDeviceEnrollmentSchema.safeParse(body.value)
    if (!parsed.success) throw new Error('Owner enrollment failed shared response validation')
    const enrollment = parsed.data
    const qr = section.locator('svg').filter({ has: page.locator('title', { hasText: 'Single-use device enrollment QR' }) })
    await qr.waitFor({ state: 'visible' })
    expect((await qr.boundingBox())?.width).toBeGreaterThan(200)

    const options = { baseUrl: scaffold.baseUrl, expectedHostId: enrollment.hostId, challenge: enrollment.challenge,
      label: 'Browser test iPhone', fetch, signal: lifetime.signal }
    const claimed = await claimDeviceEnrollment(options)
    if (!claimed.ok) throw new Error('The browser-created enrollment was refused')
    const grant = claimed.value
    const rpc = createConnectionRpc({ baseUrl: scaffold.baseUrl, randomId: () => RpcId(randomUUID()),
      fetch: (url, init) => {
        const headers = new Headers(init.headers)
        headers.set('authorization', `Bearer ${grant.credential}`)
        return fetch(url, { ...init, headers })
      },
    })
    const identity = await readHostIdentity(rpc, lifetime.signal)
    if (!identity.ok) throw new Error('The paired device could not read its Host identity')
    expect(identity.value.hostId).toBe(enrollment.hostId)
    const reused = await claimDeviceEnrollment(options)
    if (reused.ok) throw new Error('A consumed enrollment issued a second grant')
    expect(reused.error.code).toBe('connection/invalid-enrollment')
    await section.getByRole('button', { name: 'Hide QR', exact: true }).click()
    await expect.poll(() => qr.count()).toBe(0)
    await section.getByRole('button', { name: 'Refresh devices', exact: true }).click()
    await section.getByText(options.label, { exact: true }).waitFor()
    await section.getByRole('button', { name: 'Revoke access…', exact: true }).click()
    const confirmation = section.getByRole('group', { name: 'Revoke device access?', exact: true })
    await confirmation.waitFor()
    const replacements = [
      [scaffold.baseUrl, '{{host-origin}}'], [enrollment.hostId, '{{host-id}}'], [grant.device.deviceId, '{{device-id}}'],
    ] as const
    await compareOrRefreshGolden(join(EXPECTED, 'confirmation.expected.md'),
      await captureStableAria(page, 'section[aria-label="Devices"]', scaffold.workspaceCwd, { replacements }), MODE)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await readHostIdentity(rpc, lifetime.signal)).ok).toBe(true)
    await section.getByRole('button', { name: 'Revoke access…', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Revoke device access', exact: true }).click()
    await section.getByText('No devices are enrolled.', { exact: true }).waitFor()
    await expect(readHostIdentity(rpc, lifetime.signal)).rejects.toThrow('HTTP 401')
    await compareOrRefreshGolden(join(EXPECTED, 'empty.expected.md'),
      await captureStableAria(page, 'section[aria-label="Devices"]', scaffold.workspaceCwd, { replacements }), MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
