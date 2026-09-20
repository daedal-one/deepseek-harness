// Fresh remote browsers open the fork overview explicitly, without a Host acknowledgement.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { EN_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/fork-overview/overview.expected.md', import.meta.url))

describe.skipIf(MODE === 'record')('web e2e: fork overview', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ remoteAuthority: 'remote.localhost' })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: EN_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'About Daedal Harness' }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('stays closed on fresh boot and reload, opens on the first click, and supports keyboard dismissal', async () => {
    const overview = page.getByRole('dialog', { name: 'About Daedal Harness' })
    const brand = page.getByRole('button', { name: 'About Daedal Harness' })
    expect(await page.getByRole('dialog').count()).toBe(0)
    await brand.click()
    await overview.waitFor()
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)
    await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
    await page.keyboard.press('Escape')
    await overview.waitFor({ state: 'detached' })
    expect(await brand.evaluate(element => element === document.activeElement)).toBe(true)
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
    await page.keyboard.press('Enter')
    await overview.waitFor()
    await overview.getByRole('button', { name: 'Close overview' }).click()

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await brand.waitFor({ timeout: 30_000 })
    expect(await page.getByRole('dialog').count()).toBe(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click()
    await brand.click()
    await overview.waitFor()
    const box = await overview.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await overview.getByRole('link', { name: 'DeepSeek upstream' }).scrollIntoViewIfNeeded()
    expect(await overview.getByRole('link', { name: 'DeepSeek upstream' }).isVisible()).toBe(true)
    await page.keyboard.press('Escape')
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
