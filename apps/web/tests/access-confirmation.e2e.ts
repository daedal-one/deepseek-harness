// Web e2e scenario: every visible permission picker gates Full access behind
// the same locale-aware, in-page risk confirmation. Zero model calls: the
// scenario boots the shipped Web composition and exercises the real
// permission projection, client command path, HTTP RPC, and pushed update.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { EN_BROWSER_LOCALE, connectFreshWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/access-confirmation', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: Full access confirmation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // CI uses Playwright's pinned browser. A developer may point this one
    // scenario at an installed Chromium when the matching browser download
    // is temporarily unavailable.
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: EN_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('requires acknowledgement before the composer picker can enable Full access', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-full-access-confirmation'))
    const access = page.locator('button[aria-label^="Access mode"]').first()
    await access.waitFor({ timeout: 10_000 })

    expect(await access.getAttribute('aria-label')).toBe('Access mode, current: Host · Workspace Write')

    await access.hover()
    await expect.poll(() => page.getByRole('tooltip').textContent(), { timeout: 10_000 })
      .toBe('Read and edit files in the workspace. Actions outside the workspace or other sensitive operations ask for approval.')

    await access.click()
    await page.getByText('Runs on the host · file access follows this policy').waitFor()
    const fullAccess = page.getByRole('menuitem', { name: 'Full access' })
    await fullAccess.hover()
    await expect.poll(() => page.getByRole('tooltip').textContent(), { timeout: 10_000 })
      .toBe('Read, edit, and run commands within the displayed environment without routine approval. This policy does not grant access beyond that environment. Use only for trusted tasks.')
    await fullAccess.click()
    const dialog = page.getByRole('dialog', { name: 'Enable Full access?' })
    await dialog.waitFor({ timeout: 10_000 })
    const enable = dialog.getByRole('button', { name: 'Enable Full access' })
    expect(await enable.isDisabled()).toBe(true)

    // The modal is in this page's body (not a native/new window) and escapes
    // the sticky composer's stacking context.
    expect(await dialog.evaluate(node => node.parentElement?.parentElement === document.body)).toBe(true)
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

    await dialog.getByRole('checkbox', { name: 'I understand the risks and want to continue' }).check()
    expect(await enable.isEnabled()).toBe(true)
    await enable.click()
    await expect.poll(() => access.getAttribute('aria-label'), { timeout: 10_000 })
      .toBe('Access mode, current: Host · Full access')
    expect(await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the environment icon compact at phone width', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    const access = page.getByRole('button', { name: 'Access mode, current: Host · Full access' })
    expect((await access.boundingBox())?.width).toBeLessThan(60)
    await access.click()
    await page.getByText('Runs on the host · file access follows this policy').waitFor()
    const menu = page.getByRole('menu')
    const bounds = await menu.boundingBox()
    if (bounds === null) throw new Error('access menu is not visible')
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    await menu.screenshot({ path: join(tmpdir(), 'conversation-access-phone-menu.png'), animations: 'disabled' })
    await page.screenshot({ path: join(tmpdir(), 'conversation-access-phone.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1280, height: 900 })
    await access.click()
    await page.screenshot({ path: join(tmpdir(), 'conversation-access-desktop.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
  })

  it('keeps its snapshot inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
