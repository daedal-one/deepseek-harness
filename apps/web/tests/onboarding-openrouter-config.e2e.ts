// Keyless browser e2e: the shipped OpenRouter route stays mounted while its
// credential is absent, both ordered steps share the shipped modal chrome,
// and the inline key write lands in an isolated harness home without a reload
// or model call.
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_COPY, WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/onboarding-openrouter-config', import.meta.url))
const WELCOME_EXPECTED = join(SNAPSHOT_DIR, 'welcome.expected.md')
const MISSING_EXPECTED = join(SNAPSHOT_DIR, 'missing.expected.md')
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: first-run OpenRouter credential setup', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const browserConsole: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ openRouterMissingCredential: true, welcomeNoticePending: true })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    page.on('console', message => browserConsole.push(message.text()))
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('stores a key write-only and observes configured state without restarting', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-openrouter-config'))
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)
    for (const paragraph of WELCOME_NOTICE_COPY.zh.body.split('\n\n')) {
      expect(await welcome.getByText(paragraph, { exact: true }).count()).toBe(1)
    }
    expect(await welcome.getByRole('button').allTextContents()).toEqual([
      WELCOME_NOTICE_COPY.zh.continueLabel,
    ])
    const welcomeAria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WELCOME_EXPECTED, welcomeAria, MODE)

    // Observation is not acknowledgement: the exact version is persisted
    // only by the explicit action, so a reload still presents this dialog.
    const firstReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, firstReloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })

    const credentialStep = page.getByRole('dialog', { name: '添加一个 API Key 开始使用' })
    await credentialStep.waitFor({ timeout: 15_000 })
    const keyInput = credentialStep.getByLabel('API 密钥', { exact: true })
    await keyInput.waitFor({ timeout: 10_000 })
    const initial = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MISSING_EXPECTED, initial, MODE)

    const secret = `dsh_onboarding_${randomBytes(12).toString('hex')}`
    await keyInput.fill(secret)
    await credentialStep.getByRole('button', { name: '保存并继续' }).click()
    await credentialStep.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)

    const stored = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(stored.includes(`OPENROUTER_API_KEY: ${secret}`)).toBe(true)
    expect((await page.content()).includes(secret)).toBe(false)
    expect((await page.locator('body').ariaSnapshot()).includes(secret)).toBe(false)
    expect(browserConsole.some(line => line.includes(secret))).toBe(false)

    const acknowledgedSettings = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(acknowledgedSettings).toContain(`${WELCOME_NOTICE_ACK_FIELD}: ${WELCOME_NOTICE_VERSION}`)

    // The ordinary Models surface reuses the refreshed join and exposes the
    // configured write-only placeholder without a reload.
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型' }).click()
    const openRouterRow = settings.getByText('OpenRouter', { exact: true }).first()
    await openRouterRow.waitFor({ timeout: 10_000 })
    await openRouterRow.locator('xpath=ancestor::li').getByRole('button', { name: '编辑' }).click()
    const configuredInput = settings.getByLabel('API 密钥', { exact: true })
    await configuredInput.waitFor({ timeout: 10_000 })
    await expect.poll(
      () => configuredInput.getAttribute('placeholder'),
      { timeout: 10_000 },
    ).toBe('已配置——输入新值可替换')

    const secondReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, secondReloadWarnings)
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    expect(await page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title }).count()).toBe(0)
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)

    // An old acknowledgement means materially revised copy: welcome returns,
    // while the already-configured provider step remains complete.
    await scaffold.ctx.settings.mutate(settingsNamespace(WELCOME_NOTICE_SETTINGS_NAMESPACE), [{
      op: 'set', path: [WELCOME_NOTICE_ACK_FIELD], value: 'previous-copy-version',
    }])
    const thirdReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, thirdReloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)

    expect((await page.content()).includes(secret)).toBe(false)
    expect((await page.locator('body').ariaSnapshot()).includes(secret)).toBe(false)
    expect(browserConsole.some(line => line.includes(secret))).toBe(false)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('never paints the takeover chrome on a configured reload, even with the settings join held open', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-configured-reload'))
    // Regression pin for the reload flash: both steps are satisfied, yet each
    // must load private facts before deciding not to show. Dialog chrome lives
    // inside each visible branch, so the deciding window paints and blocks
    // nothing. Holding settings.describe widens that window from loopback
    // RTT scale to a deterministic hundreds of milliseconds, removing all
    // timing dependence from the sampler assertions below.
    //
    // The sampler init script persists across this shared page's later
    // navigations (init scripts re-run per navigation); that stays harmless
    // because no later scenario in this file legitimately shows the
    // takeover, and only this test reads __takeoverSightings.
    await page.addInitScript(() => {
      const sightings: string[] = []
      ;(window as unknown as { __takeoverSightings: string[] }).__takeoverSightings = sightings
      setInterval(() => {
        if (document.querySelector(
          '[role="dialog"][aria-label="内测声明"], '
          + '[role="dialog"][aria-label="添加一个 API Key 开始使用"]',
        ) !== null) {
          sightings.push('chrome')
        }
        if (document.getElementById('root')?.inert === true) sightings.push('inert')
      }, 8)
    })
    // EVERY settings.describe issued before the release is held — not just
    // the first — so the pin cannot silently collapse back to loopback
    // timing if a second boot-time consumer of the join ever appears.
    let released = false
    const heldRoutes: Array<() => void> = []
    const releaseDescribe = (): void => {
      released = true
      for (const resolve of heldRoutes.splice(0)) resolve()
    }
    await page.route('**/api/settings.describe', async (route) => {
      if (!released) await new Promise<void>((resolve) => { heldRoutes.push(resolve) })
      await route.continue()
    })
    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    // The app is painted and interactive while the steps are still deciding.
    await page.waitForTimeout(600)
    releaseDescribe()
    await page.waitForTimeout(400)
    await page.unroute('**/api/settings.describe')
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    expect(await page.evaluate(() =>
      (window as unknown as { __takeoverSightings: string[] }).__takeoverSightings)).toEqual([])
    expect(await page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title }).count()).toBe(0)
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      ['welcome.expected.md', 'missing.expected.md'],
    )
  })
})
