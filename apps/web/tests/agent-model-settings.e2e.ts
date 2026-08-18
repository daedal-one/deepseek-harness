// Keyless browser e2e: the real Agents settings page lists shipped roles,
// persists an exact OpenRouter model and reasoning effort, survives reload,
// and restores the deployment default without making a model call.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { agentModelTargetId } from '@deepseek-ai/dsh-agent-default-model'
import {
  acknowledgeReloadConnectionLoss,
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-model-settings', import.meta.url))
const PAGE_EXPECTED = join(SNAPSHOT_DIR, 'agents.expected.md')
const MODE = webSnapshotMode()
const NITRO_MODEL = 'deepseek/deepseek-v4-flash-0731:nitro'
const BASE_MODEL = 'deepseek/deepseek-v4-flash'

describe.skipIf(MODE === 'record')('web e2e: graphical per-Agent OpenRouter settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let disposeGuru: (() => void) | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ openRouterMissingCredential: true })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    disposeGuru?.()
    await browser?.close()
    await scaffold?.close()
  })

  it('persists and restores the main role while exposing named roles', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-model-settings'))
    const onboarding = page.getByRole('dialog', { name: '添加一个 API Key 开始使用' })
    await onboarding.waitFor({ timeout: 15_000 })
    await onboarding.getByRole('button', { name: '稍后配置' }).click()
    await onboarding.waitFor({ state: 'detached', timeout: 15_000 })

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '智能体', exact: true }).click()

    const main = settings.locator('[data-agent-id="main"]')
    const subagent = settings.locator('[data-agent-id="subagent"]')
    const fork = settings.locator('[data-agent-id="subagent-fork"]')
    await main.waitFor({ timeout: 15_000 })
    await subagent.waitFor({ timeout: 15_000 })
    await fork.waitFor({ timeout: 15_000 })
    disposeGuru = scaffold.ctx.agentModels.registerTarget({
      id: agentModelTargetId('guru'),
      label: 'Guru',
    })
    const guru = settings.locator('[data-agent-id="guru"]')
    await guru.waitFor({ timeout: 15_000 })
    expect(await settings.getByText('openrouter', { exact: true }).count()).toBe(4)

    const initial = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PAGE_EXPECTED, initial, MODE)

    const model = main.locator('select').nth(0)
    const reasoning = main.locator('select').nth(1)
    expect(await model.inputValue()).toBe(NITRO_MODEL)
    expect(await reasoning.inputValue()).toBe('xhigh')
    await model.selectOption(BASE_MODEL)
    await reasoning.selectOption('high')
    await main.getByRole('button', { name: '保存', exact: true }).click()
    await main.getByText('已保存。', { exact: true }).waitFor({ timeout: 15_000 })

    const persisted = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(persisted).toContain('agent-models:')
    expect(persisted).toContain(`model: ${BASE_MODEL}`)
    expect(persisted).toContain('reasoningEffort: high')

    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    await onboarding.waitFor({ timeout: 15_000 })
    await onboarding.getByRole('button', { name: '稍后配置' }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '智能体', exact: true }).click()
    await main.waitFor({ timeout: 15_000 })
    await guru.waitFor({ timeout: 15_000 })
    expect(await model.inputValue()).toBe(BASE_MODEL)
    expect(await reasoning.inputValue()).toBe('high')

    await main.getByRole('button', { name: '恢复默认值' }).click()
    await main.getByText('已保存。', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await model.inputValue()).toBe(NITRO_MODEL)
    expect(await reasoning.inputValue()).toBe('xhigh')
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['agents.expected.md'])
  })
})
