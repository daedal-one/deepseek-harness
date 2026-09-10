// Web e2e scenarios: the settings surface — the modal shell (trigger, nav,
// section switching, both close paths), the Appearance preference row (the
// real theme gesture — click Dark and the whole cascade runs: ThemeRuntime preference -> Host settings
// -> theme/change -> ui-layout's presenter -> body attribute -> alias token +
// browser theme-color metadata)
// the Language row and busy-state Enter preference (both Host-backed), plus
// Permission as the persisted default for subsequently created sessions.
// Zero model calls: everything is pure client + persistence state on a blank
// frame, so there is no fixture and a stray stream would fail loud on the
// open llm seam.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { EN_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/settings-chrome', import.meta.url))
const DIALOG_EXPECTED = join(SNAPSHOT_DIR, 'dialog.expected.md')
const PLUGINS_EXPECTED = join(SNAPSHOT_DIR, 'plugins.expected.md')
const PLUGIN_INSTANCES_EXPECTED = join(SNAPSHOT_DIR, 'plugin-instances.expected.md')
const REVIEWER_EXPECTED = join(SNAPSHOT_DIR, 'reviewer.expected.md')
// The English fallback surface: a browser naming no shipped language.
const DIALOG_EN_EXPECTED = join(SNAPSHOT_DIR, 'dialog-en.expected.md')
const PLUGIN_ROW_SELECTOR = '[data-plugin-scope="preset"] [data-plugin-entry="tool-subagent"]'
const MODE = webSnapshotMode()

describe('web e2e: settings modal and General preferences', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // Pin English so the shared page and its snapshots use the shipped copy.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: EN_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the settings dialog, switches sections, and closes by every path', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-shell'))
    const trigger = page.getByRole('button', { name: 'Settings', exact: true })
    expect(await trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    // General is active by default; Permission, Language and Appearance are functional.
    expect(await dialog.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
    await dialog.getByRole('button', { name: 'Workspace Write' }).waitFor({ timeout: 10_000 })
    await expect.poll(() => dialog.getByText('Language', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(() => dialog.getByText('Appearance', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    const openDocument = dialog.getByRole('button', { name: 'Open configuration file' })
    await openDocument.waitFor({ timeout: 10_000 })
    let openRequests = 0
    await page.route('**/api/settings/openSettingsDocument', async (route) => {
      const envelope = route.request().postDataJSON() as {
        rpcId: string
        payload: { args: Record<string, never> }
      }
      expect(envelope.payload).toEqual({ args: {} })
      openRequests += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: { opened: true } },
        }),
      })
    })
    await openDocument.click()
    await expect.poll(() => openRequests, { timeout: 5_000 }).toBe(1)
    await expect.poll(() => openDocument.isEnabled(), { timeout: 5_000 }).toBe(true)
    await page.unroute('**/api/settings/openSettingsDocument')
    // Golden of the freshly opened dialog (English, General active).
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DIALOG_EXPECTED, snapshot, MODE)
    // Section switch: aria-current moves (the Models page itself has its own scenario file).
    await dialog.getByRole('button', { name: 'Models', exact: true }).click()
    await expect.poll(() => dialog.getByRole('button', { name: 'Models', exact: true }).getAttribute('aria-current'), { timeout: 5_000 }).toBe('true')
    expect(await dialog.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBeNull()
    // Plugins is a read-only projection of the same assembled Loader tree.
    // Capture one stable shipped row rather than the whole inventory so adding
    // an unrelated plugin does not rewrite this surface's golden.
    await dialog.getByRole('button', { name: 'Plugins', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Plugins', exact: true }).waitFor({ timeout: 10_000 })
    await dialog.getByRole('tab', { name: 'Plugin list', exact: true }).click()
    // The preset group opens first with its display-only switcher; the global
    // plane starts collapsed and expands on demand.
    const presetSwitcher = dialog.getByRole('button', { name: 'Choose the agent preset to inspect' })
    await presetSwitcher.waitFor({ timeout: 10_000 })
    // The shipped default has an English display name.
    expect(await presetSwitcher.textContent()).toBe('Standard mode (default)')
    await dialog.getByRole('button', { name: /^Global/ }).click()
    const pluginRow = dialog.locator(PLUGIN_ROW_SELECTOR)
    await pluginRow.waitFor({ timeout: 10_000 })
    const expectedPluginCount = [...scaffold.ctx.loader.entries()]
      .filter(entry => !entry.options.group)
      .length
    const pluginSearch = dialog.getByRole('searchbox', { name: 'Search plugins' })
    expect(await pluginSearch.count()).toBe(1)
    // Every Loader entry appears exactly once in the global group — rows the
    // presets took over included, preset compositions excluded.
    expect(await dialog.locator('[data-plugin-scope="global"] [data-plugin-entry]').count())
      .toBe(expectedPluginCount)
    expect(await dialog.locator('[data-plugin-count]').getAttribute('data-plugin-count'))
      .toBe(String(expectedPluginCount))
    expect(await dialog.getByRole('button', { name: 'Plugins', exact: true }).getAttribute('aria-current')).toBe('true')
    expect(await dialog.getByRole('tab', { name: 'Plugin list', exact: true }).getAttribute('aria-selected')).toBe('true')
    expect(await dialog.getByRole('button', { name: 'Models', exact: true }).getAttribute('aria-current')).toBeNull()
    const pluginsSnapshot = await captureStableAria(
      page,
      PLUGIN_ROW_SELECTOR,
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(PLUGINS_EXPECTED, pluginsSnapshot, MODE)
    await pluginSearch.fill('tool-subagent')
    const instanceRows = [
      ['tool-subagent', 'Enabled'],
      ['tool-subagent-fork', 'Enabled'],
      ['tool-subagent-codex', 'Disabled'],
      ['tool-subagent-claude-code', 'Disabled'],
    ] as const
    for (const [entryId, status] of instanceRows) {
      const row = dialog.locator(`[data-plugin-scope="preset"] [data-plugin-entry="${entryId}"]`)
      const trigger = row.getByRole('button', { name: `tool-subagent, ${entryId}, ${status}`, exact: true })
      await trigger.waitFor({ timeout: 10_000 })
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
      const identity = row.locator('code')
      expect(await identity.textContent()).toBe(entryId)
      expect(await identity.getAttribute('title')).toBe(entryId)
    }
    const instancesSnapshot = await captureStableAria(
      page,
      '[data-plugin-scope="preset"] ul',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(PLUGIN_INSTANCES_EXPECTED, instancesSnapshot, MODE)
    await dialog.getByRole('button', {
      name: 'tool-subagent, tool-subagent-claude-code, Disabled',
      exact: true,
    }).click()
    expect(await dialog.locator('[data-plugin-entry="tool-subagent-claude-code"] button')
      .getAttribute('aria-expanded')).toBe('true')
    await pluginSearch.fill('')
    // Close path 1: Escape.
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog', { name: 'Settings' }).count(), { timeout: 5_000 }).toBe(0)
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    // Close path 2: the header close button (focus lands there on open).
    await trigger.click()
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => page.getByRole('dialog', { name: 'Settings' }).count(), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('describes the Daedal reviewer before disclosure and finds it by purpose', async () => {
    const fresh = await launchWebScaffold({
      agentPresets: {
        roots: [{ path: fileURLToPath(new URL('../../../docs/reference/daedal/', import.meta.url)), trust: 'user' }],
        default: 'preset',
      },
    })
    onTestFinished(() => fresh.close())
    const reviewerPage = await browser.newPage({ viewport: { width: 1280, height: 960 }, locale: 'en-US' })
    onTestFinished(() => reviewerPage.close())
    const consoleWatch = watchConsole(reviewerPage)
    await reviewerPage.goto(fresh.authenticatedUrl, { waitUntil: 'load' })
    await reviewerPage.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = reviewerPage.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Plugins', exact: true }).click()
    await dialog.getByRole('tab', { name: 'Plugin list', exact: true }).click()
    await dialog.locator('[data-plugin-scope="preset"] [data-plugin-entry="role-reviewer"]').waitFor({ timeout: 10_000 })
    expect(await dialog.locator('[data-plugin-scope="preset"] [data-plugin-entry]').count()).toBe(44)
    expect(await dialog.getByText('No description provided.', { exact: true }).count()).toBe(0)
    await dialog.getByRole('searchbox', { name: 'Search plugins' }).fill('original request')
    const selector = '[data-plugin-scope="preset"] [data-plugin-entry="role-reviewer"]'
    const row = dialog.locator(selector)
    await row.waitFor({ timeout: 10_000 })
    expect(await row.locator('button').getAttribute('aria-expanded')).toBe('false')
    expect(await row.textContent()).not.toContain('Version: Not provided')
    expect(await dialog.locator('[data-plugin-scope="preset"] [data-plugin-entry]').count()).toBe(1)
    await compareOrRefreshGolden(REVIEWER_EXPECTED, await captureStableAria(reviewerPage, selector, fresh.workspaceCwd), MODE)
    await row.locator('button').click()
    expect(await row.getByText('Daedal', { exact: true }).count()).toBe(1)
    expect(consoleWatch.pageErrors).toEqual([])
  }, 60_000)

  it('stores Permission as the default for future sessions without changing an existing session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-permission'))
    const existing = scaffold.ctx.sessions.create(SessionId('settings-permission-before'))
    expect(existing.snapshotEvents().find(event => event.type === 'permission/preset')?.data)
      .toEqual({ preset: 'workspace-write' })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    const selector = dialog.getByRole('button', { name: 'Workspace Write' })
    await selector.waitFor({ timeout: 10_000 })
    await expect.poll(() => selector.isEnabled(), { timeout: 5_000 }).toBe(true)
    await selector.click()
    await page.getByRole('menuitem', { name: 'Read Only' }).click()
    await dialog.getByRole('button', { name: 'Read Only' }).waitFor({ timeout: 10_000 })

    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('permission:')
    expect(document).toContain('defaultPreset: read-only')
    expect(existing.snapshotEvents().find(event => event.type === 'permission/preset')?.data)
      .toEqual({ preset: 'workspace-write' })

    const created = scaffold.ctx.sessions.create(SessionId('settings-permission-after'))
    expect(created.snapshotEvents().map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'read-only' }],
      ['sandbox/mode', { mode: 'read-only' }],
      ['approval/policy', { policy: 'ask' }],
    ])

    await dialog.getByRole('button', { name: 'Read Only' }).click()
    await page.getByRole('menuitem', { name: 'Full access' }).click()
    const confirmation = page.getByRole('dialog', { name: 'Enable Full access?' })
    const enable = confirmation.getByRole('button', { name: 'Enable Full access' })
    expect(await enable.isDisabled()).toBe(true)
    await confirmation.getByRole('checkbox').click()
    await enable.click()
    await dialog.getByRole('button', { name: 'Full access' }).waitFor({ timeout: 10_000 })
    const confirmedDocument = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(confirmedDocument).toContain('defaultPreset: danger-full-access')
    const confirmed = scaffold.ctx.sessions.create(SessionId('settings-permission-confirmed'))
    expect(confirmed.snapshotEvents().map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'danger-full-access' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
      ['approval/policy', { policy: 'never' }],
    ])
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  async function selectTheme(cube: Locator, preference: 'light' | 'dark' | 'system'): Promise<void> {
    // Optimistic UI and a file value from an earlier gesture do not prove this write finished.
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => {
        if (candidate.request().method() !== 'POST'
          || new URL(candidate.url()).pathname !== '/api/settings/mutate') return false
        const { payload: { args } } = candidate.request().postDataJSON() as {
          payload: { args: { ns: string; ops: { op: string; path: string[]; value?: unknown }[] } }
        }
        return args.ns === 'ui-theme' && args.ops.some(op => op.op === 'set'
          && op.path.length === 1 && op.path[0] === 'preference' && op.value === preference)
      }, { timeout: 5_000 }),
      cube.click(),
    ])
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({
      result: { ok: true, value: { ns: 'ui-theme', value: { preference } } },
    })
  }

  it('uses the persisted dark preference while plugins are still loading', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-boot-theme'))
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const initialDialog = page.getByRole('dialog', { name: 'Settings' })
    const darkCube = initialDialog.getByRole('button', { name: 'Dark' })
    await selectTheme(darkCube, 'dark')
    await expect.poll(() => darkCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-theme:\n\s+preference: dark/)
    await page.keyboard.press('Escape')

    // Hold the real application batch so the shell-owned loading page remains observable.
    const pluginPattern = /\/plugins\/\?\?.+\/client\.js,.+\/client\.js&rev=[a-f\d]{12}$/
    let releaseBundles = (): void => {}
    const bundlesReleased = new Promise<void>((resolve) => { releaseBundles = resolve })
    await page.route(pluginPattern, async (route) => {
      await bundlesReleased
      await route.continue()
    })

    const warningStart = tripwire.warnings.length
    let reload: ReturnType<Page['reload']> | undefined
    try {
      reload = page.reload({ waitUntil: 'domcontentloaded' })
      const loading = page.getByText('Loading plugins…', { exact: true })
      await loading.waitFor({ timeout: 10_000 })
      const state = await loading.evaluate((element) => {
        const boot = element.parentElement?.parentElement
        if (boot === undefined || boot === null) throw new Error('loading hint is detached from the boot page')
        return {
          attr: document.body.hasAttribute('data-ds-dark-theme'),
          background: getComputedStyle(boot).backgroundColor,
          colorScheme: document.documentElement.style.colorScheme,
        }
      })
      expect(state).toEqual({
        attr: true,
        background: 'rgb(21, 21, 23)',
        colorScheme: 'dark',
      })
    } finally {
      releaseBundles()
      await reload
      await page.unroute(pluginPattern)
    }

    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const restoredDialog = page.getByRole('dialog', { name: 'Settings' })
    const systemCube = restoredDialog.getByRole('button', { name: 'System' })
    await selectTheme(systemCube, 'system')
    await expect.poll(() => systemCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')), {
      timeout: 5_000,
    }).toBe(false)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('flips the theme through the Appearance cubes and persists across reload and a distinct port', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-appearance'))
    interface ThemeState {
      attr: boolean
      background: string
      /** Pre-migration localStorage key; the Host-backed world never writes it. */
      legacy: string | null
      themeColor: string | null
      themeColorCount: number
      token: string
    }
    const readState = async (target: Page = page): Promise<ThemeState> => await target.evaluate(() => {
      const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      const computed = getComputedStyle(document.body)
      return {
        attr: document.body.hasAttribute('data-ds-dark-theme'),
        background: computed.backgroundColor,
        legacy: localStorage.getItem('dsh.theme'),
        themeColor: metas[0]?.content ?? null,
        themeColorCount: metas.length,
        token: computed.getPropertyValue('--dsw-alias-bg-base').trim(),
      }
    })
    const expectThemeColorSynchronized = (state: ThemeState): void => {
      expect(state.themeColorCount).toBe(1)
      expect(state.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(state.themeColor).toBe(state.background)
    }
    // Pin the OS scheme to light so the default `system` preference resolves
    // light and the dark flip below is unambiguously the gesture's doing.
    await page.emulateMedia({ colorScheme: 'light' })
    const light = await readState()
    expect(light.attr).toBe(false)
    expectThemeColorSynchronized(light)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    const darkCube = dialog.getByRole('button', { name: 'Dark' })
    expect(await darkCube.getAttribute('aria-pressed')).toBe('false')
    await selectTheme(darkCube, 'dark')
    // The full cascade: pressed state, Host-backed preference, body attribute,
    // alias token flip — all from one real user gesture.
    await expect.poll(() => darkCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    const dark = await readState()
    expect(dark.attr).toBe(true)
    expect(dark.legacy).toBeNull()
    expect(dark.token).not.toBe(light.token)
    expectThemeColorSynchronized(dark)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-theme:\n\s+preference: dark/)
    await page.keyboard.press('Escape')

    // Reload: the preference survives the background Host read + presenter update.
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(true)
    const reloaded = await readState()
    expect(reloaded.legacy).toBeNull()
    expectThemeColorSynchronized(reloaded)

    // A second live Host binds another ephemeral port but shares the same
    // user-settings home. Its fresh origin has no theme localStorage and still
    // converges to dark before the settings dialog opens.
    const second = await launchWebScaffold({ harnessHome: scaffold.harnessHome })
    const secondPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: EN_BROWSER_LOCALE })
    const secondTripwire = watchConsole(secondPage)
    try {
      expect(second.baseUrl).not.toBe(scaffold.baseUrl)
      await secondPage.emulateMedia({ colorScheme: 'light' })
      await secondPage.goto(second.authenticatedUrl, { waitUntil: 'load' })
      await secondPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await expect.poll(async () => (await readState(secondPage)).attr, { timeout: 5_000 }).toBe(true)
      const secondState = await readState(secondPage)
      expect(secondState.legacy).toBeNull()
      expectThemeColorSynchronized(secondState)
      expect(secondTripwire.pageErrors).toEqual([])
      expect(secondTripwire.warnings).toEqual([])
    } finally {
      await secondPage.close()
      await second.close()
    }

    // `system` follows the emulated OS scheme (dark stays dark, light clears).
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const systemCube = page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'System' })
    await selectTheme(systemCube, 'system')
    await expect.poll(() => systemCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(false)
    expectThemeColorSynchronized(await readState())
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(true)
    expectThemeColorSynchronized(await readState())
    // Restore for the specs that follow: light preference beats the emulated
    // dark OS scheme, leaving the shared page in the light default.
    await selectTheme(page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Light' }), 'light')
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(false)
    expectThemeColorSynchronized(await readState())
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('steps the content font size, applies it to body, and persists across reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-font-size'))
    onTestFinished(async () => {
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' })
    })
    const readFontSize = async (target: Page = page): Promise<string> => await target.evaluate(
      () => document.body.style.getPropertyValue('--dsh-content-font-size'),
    )
    // The secondary tier resolved by the real engine: a probe element's
    // font-size forces min/max/calc evaluation, which the CSS-text specs
    // cannot exercise. Setting −1 at ≤14, setting −2 above.
    const readSecondaryFontSize = async (): Promise<string> => await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.fontSize = 'var(--dsh-content-font-size-secondary, 13px)'
      document.body.appendChild(probe)
      const size = getComputedStyle(probe).fontSize
      probe.remove()
      return size
    })
    // The displayed value is optimistic; wait for the write before the next step.
    const stepFontSize = async (button: Locator, px: number): Promise<void> => {
      const [response] = await Promise.all([
        page.waitForResponse((reply) => {
          if (new URL(reply.url()).pathname !== '/api/settings/mutate' || reply.request().method() !== 'POST') return false
          const request = reply.request().postDataJSON() as { payload: { args: { ns: string } } }
          return request.payload.args.ns === 'ui-theme'
        }),
        button.click(),
      ])
      expect(await response.finished()).toBeNull()
      const envelope = await response.json() as { result: { ok: boolean } }
      expect(envelope.result.ok).toBe(true)
      await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
        .toMatch(new RegExp(`ui-theme:\n(?:\\s+\\w+: .*\n)*?\\s+fontSize: ${px}`))
      await page.getByRole('dialog', { name: 'Settings' }).getByText(String(px), { exact: true }).waitFor({ timeout: 5_000 })
      await expect.poll(readFontSize, { timeout: 5_000 }).toBe(`${px}px`)
    }
    expect(await readFontSize()).toBe('14px')
    expect(await readSecondaryFontSize()).toBe('13px')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    // The stepper reveals its arrows on hover; the up arrow steps 14 → 15 → 16.
    await dialog.getByText('14', { exact: true }).hover()
    const increase = dialog.getByRole('button', { name: 'Increase font size' })
    await stepFontSize(increase, 15)
    // 15 is the piecewise boundary: the secondary tier holds at 13px (−2)
    // where the ≤14 branch would have given 14px (−1).
    await expect.poll(readSecondaryFontSize, { timeout: 5_000 }).toBe('13px')
    await stepFontSize(increase, 16)
    await expect.poll(readSecondaryFontSize, { timeout: 5_000 }).toBe('14px')
    await page.keyboard.press('Escape')

    // Reload: the boot script embeds the durable size and ThemeRuntime seeds
    // its initial snapshot from the boot-written body variable, so activation
    // never flashes the default while the settings read is in flight.
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await expect.poll(readFontSize, { timeout: 5_000 }).toBe('16px')
    expect(await readSecondaryFontSize()).toBe('14px')

    // Restore the default for the specs that follow (and the dialog golden).
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const restored = page.getByRole('dialog', { name: 'Settings' })
    await restored.waitFor({ timeout: 10_000 })
    await restored.getByText('16', { exact: true }).hover()
    const decrease = restored.getByRole('button', { name: 'Decrease font size' })
    await stepFontSize(decrease, 15)
    await stepFontSize(decrease, 14)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('persists the completed-Turn transcript mode across reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-transcript-view'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByText('Conversation display', { exact: true }).waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Compact', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Normal', exact: true }).click()
    await dialog.getByRole('button', { name: 'Normal', exact: true }).waitFor({ timeout: 10_000 })
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-chat:\n\s+transcriptView: normal/)
    await page.keyboard.press('Escape')

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const reloaded = page.getByRole('dialog', { name: 'Settings' })
    await reloaded.getByRole('button', { name: 'Normal', exact: true }).waitFor({ timeout: 10_000 })

    await reloaded.getByRole('button', { name: 'Normal', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Compact', exact: true }).click()
    await reloaded.getByRole('button', { name: 'Compact', exact: true }).waitFor({ timeout: 10_000 })
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-chat:\n\s+transcriptView: compact/)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('persists the busy-state Enter behavior across reload and a distinct port', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-enter-behavior'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Queue' }).click()
    await page.getByRole('menuitem', { name: 'Steer queued message' }).click()
    await dialog.getByRole('button', { name: 'Steer queued message' }).waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => localStorage.getItem('dsh.conversation.busyEnter'))).toBeNull()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-conversation:\n\s+busyEnter: steer/)
    await page.keyboard.press('Escape')

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const reloaded = page.getByRole('dialog', { name: 'Settings' })
    await reloaded.getByRole('button', { name: 'Steer queued message' }).waitFor({ timeout: 10_000 })

    const second = await launchWebScaffold({ harnessHome: scaffold.harnessHome })
    const secondPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: EN_BROWSER_LOCALE })
    const secondTripwire = watchConsole(secondPage)
    try {
      expect(second.baseUrl).not.toBe(scaffold.baseUrl)
      await secondPage.goto(second.authenticatedUrl, { waitUntil: 'load' })
      await secondPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await secondPage.getByRole('button', { name: 'Settings', exact: true }).click()
      await secondPage.getByRole('dialog', { name: 'Settings' })
        .getByRole('button', { name: 'Steer queued message' }).waitFor({ timeout: 10_000 })
      expect(await secondPage.evaluate(() => localStorage.getItem('dsh.conversation.busyEnter'))).toBeNull()
      expect(secondTripwire.pageErrors).toEqual([])
      expect(secondTripwire.warnings).toEqual([])
    } finally {
      await secondPage.close()
      await second.close()
    }

    await reloaded.getByRole('button', { name: 'Steer queued message' }).click()
    await page.getByRole('menuitem', { name: 'Queue' }).click()
    await reloaded.getByRole('button', { name: 'Queue' }).waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => localStorage.getItem('dsh.conversation.busyEnter'))).toBeNull()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-conversation:\n\s+busyEnter: queue/)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('persists the settings language across reload and a distinct port', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-language'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const languageDialog = page.getByRole('dialog', { name: 'Settings' })
    await languageDialog.waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
    const selector = languageDialog.getByRole('button', { name: 'English' })
    expect(await selector.getAttribute('aria-haspopup')).toBe('menu')
    await selector.click()
    expect(await page.getByRole('menuitem').allTextContents()).toEqual(['English'])
    await page.getByRole('menuitem', { name: 'English' }).click()
    const enDialog = page.getByRole('dialog', { name: 'Settings' })
    await enDialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 5_000 }).toBe('en')
    expect(await enDialog.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
    await expect.poll(() => enDialog.getByText('Appearance', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    expect(await page.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: en/)
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.getByRole('button', { name: 'Settings' }).waitFor({ timeout: 10_000 })

    // A browser on another port receives the persisted Host preference.
    const second = await launchWebScaffold({ harnessHome: scaffold.harnessHome })
    const secondPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: EN_BROWSER_LOCALE })
    const secondTripwire = watchConsole(secondPage)
    try {
      expect(second.baseUrl).not.toBe(scaffold.baseUrl)
      await secondPage.goto(second.authenticatedUrl, { waitUntil: 'load' })
      await secondPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await secondPage.getByRole('button', { name: 'Settings', exact: true }).click()
      await secondPage.getByRole('dialog', { name: 'Settings' })
        .getByRole('button', { name: 'English' }).waitFor({ timeout: 10_000 })
      expect(await secondPage.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
      expect(secondTripwire.pageErrors).toEqual([])
      expect(secondTripwire.warnings).toEqual([])
    } finally {
      await secondPage.close()
      await second.close()
    }

    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('opens an English browser in English without any stored preference', async () => {
    const fresh = await launchWebScaffold({})
    const enPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
    const enTripwire = watchConsole(enPage)
    onTestFailed(() => saveFailureShot(enPage, 'web-e2e-settings-browser-language'))
    try {
      await enPage.goto(fresh.authenticatedUrl, { waitUntil: 'load' })
      await enPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      expect(await enPage.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
      await enPage.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = enPage.getByRole('dialog', { name: 'Settings' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByRole('button', { name: 'English' }).waitFor({ timeout: 10_000 })
      // The plugin list resolves the shipped preset name in English.
      await dialog.getByRole('button', { name: 'Plugins', exact: true }).click()
      await dialog.getByRole('tab', { name: 'Plugin list', exact: true }).click()
      const presetSwitcher = dialog.getByRole('button', { name: 'Choose the agent preset to inspect' })
      await presetSwitcher.waitFor({ timeout: 10_000 })
      expect(await presetSwitcher.textContent()).toBe('Standard mode (default)')
      // This page has no closing inventory spec to sweep its console, so the
      // scenario clears both tripwire channels itself.
      expect(enTripwire.pageErrors).toEqual([])
      expect(enTripwire.warnings).toEqual([])
    } finally {
      await enPage.close()
      await fresh.close()
    }
  }, 90_000)

  it('opens a browser asking for no shipped language in English', async () => {
    const fresh = await launchWebScaffold({})
    const frPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'fr-FR' })
    const frTripwire = watchConsole(frPage)
    onTestFailed(() => saveFailureShot(frPage, 'web-e2e-settings-unshipped-language'))
    try {
      await frPage.goto(fresh.authenticatedUrl, { waitUntil: 'load' })
      await frPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      expect(await frPage.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
      await frPage.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = frPage.getByRole('dialog', { name: 'Settings' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByRole('button', { name: 'English' }).waitFor({ timeout: 10_000 })
      // A locale-owned nav label proves the dictionaries resolved to en.
      await dialog.getByRole('button', { name: 'Agent presets' }).waitFor({ timeout: 10_000 })
      expect(await frPage.evaluate(() => document.documentElement.lang)).toBe('en')
      const snapshot = await captureStableAria(frPage, '[role="dialog"]', fresh.workspaceCwd)
      await compareOrRefreshGolden(DIALOG_EN_EXPECTED, snapshot, MODE)
      expect(frTripwire.pageErrors).toEqual([])
      expect(frTripwire.warnings).toEqual([])
    } finally {
      await frPage.close()
      await fresh.close()
    }
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'dialog-en.expected.md',
      'dialog.expected.md',
      'plugin-instances.expected.md',
      'plugins.expected.md',
      'reviewer.expected.md',
    ])
  })
})
