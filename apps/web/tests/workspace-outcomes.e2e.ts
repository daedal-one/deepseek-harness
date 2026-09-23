/** Browser projection of recorded workspace receipts; container behavior has separate Linux coverage. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as WorkspaceOutcomes from '../../../packages/sandbox/local-container-runtime/tests/fixtures/workspace-outcomes.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it.each([false, true])('keeps workspace return and pending recovery visible with provenance=%s', async (provenance) => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL(`../../../snapshots/sdk/${provenance ? 'workspace-provenance' : 'workspace-outcomes'}/session.v3.jsonl`, import.meta.url)),
    compareReplaySession: false,
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let handle: Awaited<ReturnType<typeof scaffold.ctx.agents.create>> | undefined
  try {
    await scaffold.ctx.plugin(WorkspaceOutcomes, { environment: false, provenance })
    handle = await scaffold.ctx.agents.create({ sessionId: SessionId('workspace-outcomes-browser'),
      meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Reply with exactly: SDK snapshot OK' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
    await page.getByText('SDK snapshot OK', { exact: true }).waitFor()
    const returned = page.locator('[data-workspace-phase="returned"]')
    await returned.waitFor()
    if (provenance) {
      expect(await returned.locator(':scope > div > ul > li').count()).toBe(1)
      expect(await returned.innerText()).toContain('dsh/fix-recovery-111111111111111111111111/turn-1')
      expect(await returned.innerText()).not.toContain('dsh/fix-recovery-222222222222222222222222/turn-1')
      await returned.getByText('Other branches at this commit (1)', { exact: true }).click()
      expect(await returned.innerText()).toContain('dsh/fix-recovery-222222222222222222222222/turn-1')
      if (process.env.DSH_WORKSPACE_UI_SCREENSHOT !== undefined) await page.screenshot({ path: `${process.env.DSH_WORKSPACE_UI_SCREENSHOT}.returned.png`, fullPage: true })
    } else expect(await returned.innerText()).toContain('dsh/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/main/turn-1')
    const event = handle.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
    if (event?.type !== 'workspace/state') throw new Error('missing workspace return fixture')
    handle.agent.session.append('workspace/state', { ...event.data, phase: 'pending', error: 'Result branch changed outside this conversation.' })
    const pending = page.locator('[data-workspace-phase="pending"]')
    await pending.waitFor()
    await pending.locator('summary').click()
    expect(await pending.innerText()).toContain('Result branch changed outside this conversation.')
    expect(await page.getByText('SDK snapshot OK', { exact: true }).isVisible()).toBe(true)
    if (process.env.DSH_WORKSPACE_UI_SCREENSHOT !== undefined) {
      await page.screenshot({ path: process.env.DSH_WORKSPACE_UI_SCREENSHOT, fullPage: true })
    }
    expect(console.pageErrors).toEqual([])
    expect(console.warnings).toEqual([])
  } finally {
    const results = await Promise.allSettled([browser?.close(), handle?.dispose()])
    await scaffold.close()
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'workspace browser teardown failed')
  }
})
