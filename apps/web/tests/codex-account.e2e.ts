/** Saved Codex account recovery and native login controls in the assembled Web app. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { EN_BROWSER_LOCALE, saveFailureShot } from './support.ts'

let home: string
let scaffold: WebScaffold
let browser: Browser
let page: Page
const expected = fileURLToPath(new URL('./expected/codex-account/', import.meta.url))
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-web-codex-'))
  const credential = JSON.stringify({ type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: 1, accountId: 'fixture-account' })
  await writeFile(join(home, '.credentials.yaml'), `version: 1\nrefs:\n  DSH_PI_AI_OPENAI_CODEX_AUTH: ${JSON.stringify(credential)}\n`, { mode: 0o600 })
  await writeFile(join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    openai-codex: {}\n')
  scaffold = await launchWebScaffold({ harnessHome: home, openRouterMissingCredential: true })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: EN_BROWSER_LOCALE })
  await page.goto(scaffold.authenticatedUrl)
}, 120_000)
afterAll(async () => {
  try { await browser?.close() } finally {
    try { await scaffold?.close() } finally { if (home !== undefined) await rm(home, { recursive: true, force: true }) }
  }
})

it('shows the migrated account, signs out, and cancels the native login chooser', async () => {
  onTestFailed(() => saveFailureShot(page, 'web-e2e-codex-account'))
  expect(await scaffold.ctx.authorizationController.list()).toContainEqual(expect.objectContaining({ key: 'llm-pi-ai/openai-codex', configured: true }))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Models', exact: true }).click()
  await dialog.getByRole('button', { name: /Edit.*codex/i }).click()
  await dialog.getByText('Signed in', { exact: true }).waitFor()
  expect(await dialog.getByLabel('API key', { exact: true }).count()).toBe(0)
  await compareOrRefreshGolden(join(expected, 'signed-in.expected.md'), await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
  const migrated = await readFile(join(home, '.credentials.yaml'), 'utf8')
  expect(migrated).toContain('llm-pi-ai/openai-codex')
  expect(migrated).not.toContain('DSH_PI_AI_OPENAI_CODEX_AUTH')
  expect(await dialog.textContent()).not.toMatch(/fixture-access|fixture-refresh/)
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click()
  await dialog.getByText('Not signed in', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: /ChatGPT/ }).click()
  await dialog.getByRole('button', { name: /Device code/i }).waitFor()
  await compareOrRefreshGolden(join(expected, 'sign-in.expected.md'), await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).first().click()
  await dialog.getByText('Sign-in cancelled.', { exact: true }).waitFor()
  expect(await readFile(join(home, '.credentials.yaml'), 'utf8')).not.toContain('fixture-refresh')
}, 60_000)
