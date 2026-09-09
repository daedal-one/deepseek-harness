// Keyless browser e2e: the real Agents settings page lists mixed-provider
// roles, persists an exact model and reasoning effort, survives reload, and
// restores the deployment default without making a model call.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { agentModelTargetId } from '@deepseek-ai/dsh-agent-default-model'
import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
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
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/agent-model-settings', import.meta.url))
const PAGE_EXPECTED = join(SNAPSHOT_DIR, 'agents.expected.md')
const MODE = webSnapshotMode()
const NITRO_MODEL = 'deepseek/deepseek-v4-flash-0731:nitro'
const BASE_MODEL = 'deepseek/deepseek-v4-flash'

const CODEX_MODELS: readonly LlmModelInfo[] = [
  { provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  { provider: 'openai-codex', id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
]

/** Keyless catalog-only route used to prove mixed-provider graphical settings. */
class CodexCatalogAdapter extends LlmAdapter {
  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(CODEX_MODELS)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const found = CODEX_MODELS.find(candidate => candidate.id === model)
    if (found === undefined) throw new Error(`unknown Codex model ${model}`)
    return Promise.resolve({
      ...found,
      provider,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('minimal'), name: 'Minimal' },
          { id: ReasoningEffortId('xhigh'), name: 'Extra high' },
          { id: ReasoningEffortId('max'), name: 'Maximum' },
        ],
        defaultEffort: ReasoningEffortId('xhigh'),
      },
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('the Agent settings fixture never calls a model')
  }
}

describe.skipIf(MODE === 'record')('web e2e: graphical per-Agent model settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let presetAgent: AgentHandle | undefined
  let disposeGuru: (() => void) | undefined
  let disposeCodexTarget: (() => void) | undefined
  let disposeCodexAdapter: (() => void) | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ openRouterMissingCredential: true })
    disposeCodexAdapter = scaffold.ctx.llm.registerAdapter(['openai-codex'], new CodexCatalogAdapter())
    disposeCodexTarget = scaffold.ctx.agentModels.registerTarget({
      id: agentModelTargetId('daedal-openai-reviewer'),
      label: 'Daedal OpenAI reviewer',
      defaultSelection: {
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: ReasoningEffortId('xhigh'),
      },
    })
    presetAgent = await scaffold.ctx.agents.create({
      sessionId: SessionId('model-settings-preset'),
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 960)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await presetAgent?.dispose()
    disposeGuru?.()
    disposeCodexTarget?.()
    disposeCodexAdapter?.()
    await browser?.close()
    await scaffold?.close()
  })

  it('persists and restores the main role while exposing named roles', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-model-settings'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: 'Agents', exact: true }).click()

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
    const codexReviewer = settings.locator('[data-agent-id="daedal-openai-reviewer"]')
    await guru.waitFor({ timeout: 15_000 })
    await codexReviewer.waitFor({ timeout: 15_000 })
    expect(await settings.getByText('openrouter', { exact: true }).count()).toBe(4)
    expect(await settings.getByText('openai-codex', { exact: true }).count()).toBe(1)

    const initial = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PAGE_EXPECTED, initial, MODE)

    const model = main.locator('select').nth(0)
    const reasoning = main.locator('select').nth(1)
    expect(await model.inputValue()).toBe(NITRO_MODEL)
    expect(await reasoning.inputValue()).toBe('xhigh')
    await model.selectOption(BASE_MODEL)
    await reasoning.selectOption('high')
    await main.getByRole('button', { name: 'Apply', exact: true }).click()
    await main.getByText('Saved.', { exact: true }).waitFor({ timeout: 15_000 })

    const persisted = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(persisted).toContain('agent-models:')
    expect(persisted).toContain(`model: ${BASE_MODEL}`)
    expect(persisted).toContain('reasoningEffort: high')

    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: 'Agents', exact: true }).click()
    await main.waitFor({ timeout: 15_000 })
    await guru.waitFor({ timeout: 15_000 })
    expect(await model.inputValue()).toBe(BASE_MODEL)
    expect(await reasoning.inputValue()).toBe('high')

    await main.getByRole('button', { name: 'Restore default' }).click()
    await main.getByText('Saved.', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await model.inputValue()).toBe(NITRO_MODEL)
    expect(await reasoning.inputValue()).toBe('xhigh')
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['agents.expected.md'])
  })
})
