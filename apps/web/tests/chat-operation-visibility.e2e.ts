import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, parseSeedFixture, renderSeedFixture, seedSession,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/chat-operation-visibility/compact.expected.md', import.meta.url))
const MODE = webSnapshotMode()

function withActivitySummary(raw: string): string {
  const { headerLine, events } = parseSeedFixture(raw)
  const tail = events.at(-1)
  if (tail?.type !== 'turn/end') throw new Error('operation fixture must end with a closed Turn')
  const operationSeqs = events.filter(event => event.type === 'tool/result' || event.type === 'assistant/message')
    .map(event => event.seq)
  const throughSeq = operationSeqs.at(-1)
  if (throughSeq === undefined) throw new Error('operation fixture must contain process evidence')
  const summary = { type: 'activity-summary/update', seq: tail.seq, time: tail.time, data: {
    turn: tail.data.turn, revision: 1, operationSeqs, throughSeq,
    lines: ['Read both files.', 'Prepared the final response.'],
    route: { provider: 'fixture', model: 'activity-status' },
  } }
  return renderSeedFixture(headerLine, [
    ...events.slice(0, -1),
    summary,
    { ...tail, seq: tail.seq + 1, time: tail.time + 1 },
  ])
}

describe.skipIf(MODE === 'record')('web e2e: compact operation visibility', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, withActivitySummary(await readFile(FIXTURE, 'utf8')), 'operation-visibility-fixture')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('treeitem').first().click()
    await page.getByRole('treeitem').nth(1).click()
    await page.locator('[data-turn-process]').waitFor({ timeout: 15_000 })
  })

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('retains the latest operation and opens earlier details with the keyboard', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-operation-visibility'))
    const tools = page.locator('[data-chat-flow-kind="tool-call"]')
    const thoughts = page.locator('[data-variant="think"]')
    const process = page.locator('[data-turn-process]')
    expect(await tools.count()).toBe(2)
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await tools.first().isVisible()).toBe(false)
    expect(await tools.last().isVisible()).toBe(true)
    expect(await thoughts.first().isVisible()).toBe(false)
    expect(await thoughts.last().isVisible()).toBe(true)
    expect(await page.getByRole('status', { name: 'Agent activity summary' }).isVisible()).toBe(true)
    await compareOrRefreshGolden(EXPECTED,
      await captureStableAria(page, '[data-chat-flow]', scaffold.workspaceCwd), MODE)

    await process.focus()
    await process.press('Enter')
    expect(await process.getAttribute('aria-expanded')).toBe('true')
    expect(await tools.first().isVisible()).toBe(true)
    expect(await thoughts.first().isVisible()).toBe(true)
    await process.press(' ')
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await tools.first().isVisible()).toBe(false)
    expect(await tools.last().isVisible()).toBe(true)

    const thinking = thoughts.last().locator('[data-disclosure-row]')
    await thinking.press('Enter')
    expect(await thinking.getAttribute('aria-expanded')).toBe('true')
    expect(await thoughts.last().locator('[class*="thinkBody"]').isVisible()).toBe(true)
    await thinking.press(' ')
    expect(await thinking.getAttribute('aria-expanded')).toBe('false')
    await tools.last().getByRole('button', { name: 'Load full result' }).press('Enter')
    const tool = tools.last().locator('[data-disclosure-row]').first()
    await expect.poll(() => tool.getAttribute('aria-expanded')).toBe('false')
    await tool.press('Enter')
    expect(await tool.getAttribute('aria-expanded')).toBe('true')
    await expect.poll(() => tools.last().getByText(/1: beta/).isVisible()).toBe(true)
    await tool.press(' ')
    expect(await tool.getAttribute('aria-expanded')).toBe('false')
    await process.click()
    expect(await tools.first().isVisible()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('restores all operations in Normal and retains the latest ones in Compact', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-operation-visibility-setting'))
    const process = page.locator('[data-turn-process]')
    const tools = page.locator('[data-chat-flow-kind="tool-call"]')
    const thoughts = page.locator('[data-variant="think"]')
    if (await process.getAttribute('aria-expanded') === 'true') await process.click()
    expect(await tools.first().isVisible()).toBe(false)
    expect(await tools.last().isVisible()).toBe(true)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Compact', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Normal', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => process.count()).toBe(0)
    expect(await tools.first().isVisible()).toBe(true)
    expect(await thoughts.first().isVisible()).toBe(true)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Normal', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Compact', exact: true }).click()
    await page.keyboard.press('Escape')
    await process.waitFor({ state: 'visible' })
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await tools.first().isVisible()).toBe(false)
    expect(await tools.last().isVisible()).toBe(true)
    expect(await thoughts.first().isVisible()).toBe(false)
    expect(await thoughts.last().isVisible()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
