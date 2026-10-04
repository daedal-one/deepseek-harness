/** Recorded Session history opens a real profile terminal without a model request. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))

// These shell commands and stty assert the POSIX backend; Windows provider behavior has its own lane.
describe.skipIf(process.platform === 'win32' || webSnapshotMode() === 'record')('web e2e: Session terminal', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    await seedSession(scaffold, await readFile(SEED, 'utf8'), 'terminal-web-session')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const searchButton = page.getByRole('button', { name: 'Search sessions' })
    if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
    await page.getByPlaceholder('Search sessions', { exact: false }).fill('Use the read tool twice')
    const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await result.waitFor({ timeout: 15_000 })
    await result.click()
    await page.getByRole('tab', { name: 'Terminal', exact: true }).click()
  })

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('runs in the Session cwd, keeps shell state across tabs, resizes and replaces only on restart', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-terminal'))
    const rows = page.locator('.xterm-rows')
    const input = page.locator('.xterm-helper-textarea')
    await expect.poll(() => rows.textContent(), { timeout: 20_000 }).toContain('$')

    await input.pressSequentially('export TERMINAL_CHECK=KEPT; printf "\\nTERMINAL_%s\\n" "$TERMINAL_CHECK"; pwd; printf created > terminal-created.txt')
    await input.press('Enter')
    await expect.poll(() => rows.textContent(), { timeout: 15_000 }).toContain('TERMINAL_KEPT')
    await expect.poll(() => readFile(join(scaffold.workspaceCwd, 'terminal-created.txt'), 'utf8')).toBe('created')
    expect(await rows.textContent()).toContain(scaffold.workspaceCwd)
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('tab', { name: 'Terminal', exact: true }).click()
    await input.pressSequentially('printf "\\nSTILL_%s\\n" "$TERMINAL_CHECK"')
    await input.press('Enter')
    await expect.poll(() => rows.textContent()).toContain('STILL_KEPT')
    await page.setViewportSize({ width: 900, height: 650 })
    await input.pressSequentially('stty size')
    await input.press('Enter')
    await expect.poll(() => rows.textContent()).toMatch(/\d+\s+\d+/u)
    await page.getByRole('button', { name: 'Restart terminal', exact: true }).click()
    await expect.poll(() => rows.textContent(), { timeout: 20_000 }).not.toContain('STILL_KEPT')
    await expect.poll(() => rows.textContent(), { timeout: 20_000 }).toContain('$')
    await input.pressSequentially('printf "\\nAFTER_%s\\n" "${TERMINAL_CHECK-unset}"')
    await input.press('Enter')
    await expect.poll(() => rows.textContent()).toContain('AFTER_unset')
    const viewport = await page.getByLabel('Session terminal', { exact: true }).boundingBox()
    const composer = await page.locator('[data-composer-seat]').boundingBox()
    expect(viewport).not.toBeNull()
    expect(composer).not.toBeNull()
    if (viewport === null || composer === null) throw new Error('terminal or composer viewport is missing')
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(composer.y)
    const snapshot = await captureStableAria(page, '[data-session-terminal-controls]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/session-terminal.ui.expected.md', import.meta.url)), snapshot, webSnapshotMode())
    await page.screenshot({ path: '/tmp/dsh-session-terminal.png' })
    expect(tripwire.pageErrors).toEqual([])
  })
})
