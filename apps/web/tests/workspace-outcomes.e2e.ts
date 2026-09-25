/** Browser projection of recorded workspace receipts; container behavior has separate Linux coverage. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceAdmissionId } from '../../../packages/sandbox/local-container-runtime/src/workspace-types.ts'
import * as WorkspaceOutcomes from '../../../packages/sandbox/local-container-runtime/tests/fixtures/workspace-outcomes.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'

it('keeps the selected workspace and shows cancellable waiting before the first turn', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL('../../../snapshots/sdk/workspace-outcomes/session.v3.jsonl', import.meta.url)),
    compareReplaySession: false,
  })
  const capacity = Promise.withResolvers<undefined>()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const admitted = new Set<string>()
  const failures: unknown[] = []
  let attempt = 0
  scaffold.ctx.on('agent/turn-starting', async ({ agent, signal }, next) => {
    const id = brandString<WorkspaceAdmissionId>(`browser-admission-${++attempt}`)
    agent.session.append('workspace/admission', { id, status: 'waiting' })
    const cancelled = Promise.withResolvers<undefined>()
    const abort = () => { cancelled.resolve(undefined) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await Promise.race([capacity.promise, cancelled.promise])
      agent.session.append('workspace/admission', { id, status: signal.aborted ? 'cancelled' : 'admitted' })
      signal.throwIfAborted()
      admitted.add(agent.id)
      await next()
    } finally { signal.removeEventListener('abort', abort) }
  })
  try {
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'deepseek-harness')
    const input = page.locator('[data-composer-input]').first()
    await writeComposerDraft(page, input, 'Reply with exactly: SDK snapshot OK')
    await input.press('Enter')
    await page.getByText('Waiting for workspace capacity…', { exact: true }).waitFor()
    expect(admitted.size).toBe(0)
    expect(await page.getByText('Deep diving...', { exact: true }).count()).toBe(0)
    expect(await page.getByRole('treeitem', { name: /deepseek-harness/ }).count()).toBeGreaterThan(0)
    await page.reload({ waitUntil: 'load' })
    await page.getByText('Waiting for workspace capacity…', { exact: true }).waitFor()
    if (process.env.DSH_WORKSPACE_UI_SCREENSHOT !== undefined) {
      await page.screenshot({ path: `${process.env.DSH_WORKSPACE_UI_SCREENSHOT}.waiting.png`, fullPage: true })
    }
    await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
    await page.getByText('Waiting for workspace capacity…', { exact: true }).waitFor({ state: 'hidden' })
    expect(admitted.size).toBe(0)
    expect(await page.getByRole('treeitem', { name: /deepseek-harness/ }).count()).toBeGreaterThan(0)
    capacity.resolve(undefined)
    await writeComposerDraft(page, input, 'Reply with exactly: SDK snapshot OK')
    await input.press('Enter')
    await page.getByText('SDK snapshot OK', { exact: true }).waitFor()
    expect(admitted.size).toBe(1)
    await page.reload({ waitUntil: 'load' })
    await page.getByText('SDK snapshot OK', { exact: true }).waitFor()
    expect(await page.getByRole('treeitem', { name: /deepseek-harness/ }).count()).toBeGreaterThan(0)
    expect(console.pageErrors).toEqual([])
  } catch (error) { failures.push(error) } finally {
    capacity.resolve(undefined)
    const results = await Promise.allSettled([browser?.close(), scaffold.close()])
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
  }
  if (failures.length > 0) throw new AggregateError(failures, 'workspace queue browser verification failed')
})

it.each([false, true])('keeps workspace return and pending recovery visible with provenance=%s', async (provenance) => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL(`../../../snapshots/sdk/${provenance ? 'workspace-provenance' : 'workspace-outcomes'}/session.v3.jsonl`, import.meta.url)),
    compareReplaySession: false,
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let handle: Awaited<ReturnType<typeof scaffold.ctx.agents.create>> | undefined
  try {
    await scaffold.ctx.plugin(WorkspaceOutcomes, { provenance })
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
      expect(await returned.locator(':scope > ul > li').count()).toBe(1)
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
