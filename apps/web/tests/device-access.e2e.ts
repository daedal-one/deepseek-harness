/** Browser-owner enrollment and public device admission through the shipped Web composition. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { EN_BROWSER_LOCALE } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/device-access', import.meta.url))
const MODE = webSnapshotMode()

interface Enrollment {
  hostId: string
  challenge: string
}
interface Grant {
  hostId: string
  credential: string
  device: { deviceId: string }
}
type ClaimResult = { ok: true; value: Grant } | { ok: false; error: { code: string } }

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function enrollmentFrom(value: unknown): Enrollment {
  if (!isRecord(value) || typeof value.hostId !== 'string' || typeof value.challenge !== 'string') {
    throw new Error('Owner enrollment returned an invalid response')
  }
  return { hostId: value.hostId, challenge: value.challenge }
}

async function claimDeviceEnrollment(options: {
  baseUrl: string
  expectedHostId: string
  challenge: string
  label: string
  signal: AbortSignal
}): Promise<ClaimResult> {
  const response = await fetch(new URL('/api/connection/devices/claim', options.baseUrl), {
    method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostId: options.expectedHostId, challenge: options.challenge, label: options.label }),
    signal: options.signal,
  })
  const result: unknown = await response.json()
  if (!isRecord(result) || typeof result.ok !== 'boolean') throw new Error('Device claim returned an invalid response')
  if (!result.ok) {
    if (!isRecord(result.error) || typeof result.error.code !== 'string') throw new Error('Device claim returned an invalid failure')
    return { ok: false, error: { code: result.error.code } }
  }
  if (!isRecord(result.value) || typeof result.value.hostId !== 'string' || typeof result.value.credential !== 'string'
    || !isRecord(result.value.device) || typeof result.value.device.deviceId !== 'string') {
    throw new Error('Device claim returned an invalid grant')
  }
  return { ok: true, value: {
    hostId: result.value.hostId,
    credential: result.value.credential,
    device: { deviceId: result.value.device.deviceId },
  } }
}

async function readHostIdentity(
  baseUrl: string,
  credential: string,
  signal: AbortSignal,
): Promise<{ ok: true; value: { hostId: string } }> {
  const rpcId = randomUUID()
  const response = await fetch(new URL('/api/connection/identity', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'connection/identity', payload: {} }), signal,
  })
  if (!response.ok) throw new Error(`transport failure for /api/connection/identity: HTTP ${response.status}`)
  const envelope: unknown = await response.json()
  if (!isRecord(envelope) || envelope.rpcId !== rpcId || !isRecord(envelope.result) || envelope.result.ok !== true
    || !isRecord(envelope.result.value) || typeof envelope.result.value.hostId !== 'string') {
    throw new Error('Host identity returned an invalid response')
  }
  return { ok: true, value: { hostId: envelope.result.value.hostId } }
}

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
    const enrollment = enrollmentFrom(body.value)
    const qr = section.locator('svg').filter({ has: page.locator('title', { hasText: 'Single-use device enrollment QR' }) })
    await qr.waitFor({ state: 'visible' })
    expect((await qr.boundingBox())?.width).toBeGreaterThan(200)

    const options = { baseUrl: scaffold.baseUrl, expectedHostId: enrollment.hostId, challenge: enrollment.challenge,
      label: 'Browser test iPhone', signal: lifetime.signal }
    const claimed = await claimDeviceEnrollment(options)
    if (!claimed.ok) throw new Error('The browser-created enrollment was refused')
    const grant = claimed.value
    const identity = await readHostIdentity(scaffold.baseUrl, grant.credential, lifetime.signal)
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
    expect((await readHostIdentity(scaffold.baseUrl, grant.credential, lifetime.signal)).ok).toBe(true)
    await section.getByRole('button', { name: 'Revoke access…', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Revoke device access', exact: true }).click()
    await section.getByText('No devices are enrolled.', { exact: true }).waitFor()
    await expect(readHostIdentity(scaffold.baseUrl, grant.credential, lifetime.signal)).rejects.toThrow('HTTP 401')
    await compareOrRefreshGolden(join(EXPECTED, 'empty.expected.md'),
      await captureStableAria(page, 'section[aria-label="Devices"]', scaffold.workspaceCwd, { replacements }), MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
