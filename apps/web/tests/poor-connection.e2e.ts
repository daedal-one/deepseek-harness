import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Browser, CDPSession, Page, Route } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SESSION_ID = 'poor-connection-production-history'
const SESSION_TITLE = 'POOR_CONNECTION_PRODUCTION_HISTORY'
const HISTORY_TURNS = 120
const TAIL_TURNS = 8
const HISTORY_MAX_BYTES = 512 * 1024
const COLD_BOOT_MAX_MS = 8_000
const WARM_BOOT_MAX_MS = 2_000
const COLD_BOOT_MAX_BYTES = 1.2 * 1024 * 1024
const HISTORY_MAX_MS = 12_000

interface Transfer {
  requestId: string
  url: string
  method?: string
  type?: string
  status?: number
  headers?: Record<string, string>
  encodedBytes?: number
  fromDiskCache?: boolean
  servedFromCache?: boolean
}

function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

function detailPayload(turn: number): string {
  const blocks = Array.from({ length: 384 }, (_, index) =>
    createHash('sha256').update(`${String(turn)}:${String(index)}`).digest('base64'))
  return `POOR_NETWORK_DETAIL_${String(turn)}\n${blocks.join('')}`
}

function appendFinalAssistant(session: Session, turn: number): void {
  const step = 2
  const final = `POOR_NETWORK_ASSISTANT_${String(turn)} ${'settled response '.repeat(24)}`
  const chunks = [
    session.append('assistant/chunk', {
      turn, step, chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }).seq,
    session.append('assistant/chunk', {
      turn, step, chunk: { type: 'text-delta', index: 0, text: `POOR_NETWORK_ASSISTANT_${String(turn)} ` },
    }).seq,
    session.append('assistant/chunk', {
      turn, step, chunk: { type: 'text-delta', index: 0, text: 'settled response '.repeat(24) },
    }).seq,
    session.append('assistant/chunk', {
      turn, step, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: final } },
    }).seq,
    session.append('assistant/chunk', {
      turn, step, chunk: { type: 'finish', reason: { kind: 'stop' } },
    }).seq,
  ]
  session.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      content: text(final),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
    usage: { inputTokens: 1_024, outputTokens: 128 },
  }, { surfaceOp: 'append', sourceEventSeqs: chunks })
}

function productionHistoryFixture(): string {
  const session = Session.create(SessionId(SESSION_ID))
  for (let turn = 1; turn <= HISTORY_TURNS; turn += 1) {
    session.append('turn/start', { turn })
    const user = session.append('user/message', createUserMessage({
      content: text(`POOR_NETWORK_USER_${String(turn)} ${'production context '.repeat(12)}`),
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    if (turn === 1) {
      session.append('session/title', {
        title: SESSION_TITLE,
        messageSeqs: [user.seq],
        source: { kind: 'fallback' },
      })
    }

    const callId = CallId(`poor-network-call-${String(turn)}`)
    const args = JSON.stringify({ turn, probe: 'poor-connection' })
    session.append('step/start', { turn, step: 1 })
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'poor_connection_probe', arguments: args }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    const call = session.append('tool/call', {
      turn, step: 1, callId, name: 'poor_connection_probe', arguments: args,
    })
    session.append('tool/result', {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: text(detailPayload(turn)),
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    session.append('step/end', { turn, step: 1 })
    session.append('step/start', { turn, step: 2 })
    appendFinalAssistant(session, turn)
    session.append('step/end', { turn, step: 2 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: Date.now() - 60_000,
      cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify(event)),
    '',
  ].join('\n')
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]))
}

async function installTransferProbe(cdp: CDPSession): Promise<Map<string, Transfer>> {
  const transfers = new Map<string, Transfer>()
  await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', (event) => {
    let method: string | undefined
    if (event.request.postData !== undefined) {
      try {
        const body = JSON.parse(event.request.postData) as { method?: unknown }
        if (typeof body.method === 'string') method = body.method
      } catch {
        // Non-JSON requests have no RPC method.
      }
    }
    transfers.set(event.requestId, {
      requestId: event.requestId,
      url: event.request.url,
      ...method === undefined ? {} : { method },
    })
  })
  cdp.on('Network.responseReceived', (event) => {
    const current = transfers.get(event.requestId)
    if (current === undefined) return
    transfers.set(event.requestId, {
      ...current,
      type: event.type,
      status: event.response.status,
      headers: normalizeHeaders(event.response.headers),
      ...event.response.fromDiskCache === undefined ? {} : { fromDiskCache: event.response.fromDiskCache },
    })
  })
  cdp.on('Network.requestServedFromCache', (event) => {
    const current = transfers.get(event.requestId)
    if (current !== undefined) transfers.set(event.requestId, { ...current, servedFromCache: true })
  })
  cdp.on('Network.loadingFinished', (event) => {
    const current = transfers.get(event.requestId)
    if (current !== undefined) transfers.set(event.requestId, { ...current, encodedBytes: event.encodedDataLength })
  })
  return transfers
}

async function throttle(cdp: CDPSession, profile: 'fast-3g' | 'slow-400' | 'offline'): Promise<void> {
  const offline = profile === 'offline'
  const slow = profile === 'slow-400'
  await cdp.send('Network.emulateNetworkConditions', {
    offline,
    latency: offline ? 0 : slow ? 400 : 150,
    downloadThroughput: offline ? 0 : (slow ? 400_000 : 1_600_000) / 8,
    uploadThroughput: offline ? 0 : (slow ? 400_000 : 750_000) / 8,
    connectionType: 'cellular3g',
  })
}

async function waitForShell(page: Page): Promise<void> {
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 30_000 })
}

function appTransfers(transfers: Map<string, Transfer>, baseUrl: string): Transfer[] {
  return [...transfers.values()].filter(transfer =>
    transfer.url.startsWith(baseUrl) && transfer.encodedBytes !== undefined)
}

async function bodyBytes(cdp: CDPSession, transfer: Transfer): Promise<number> {
  const response = await cdp.send('Network.getResponseBody', { requestId: transfer.requestId })
  return response.base64Encoded
    ? Buffer.from(response.body, 'base64').byteLength
    : Buffer.byteLength(response.body, 'utf8')
}

async function fulfillTimeout(route: Route): Promise<void> {
  const request = route.request().postDataJSON() as { rpcId: string }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      type: 'server-response',
      rpcId: request.rpcId,
      result: {
        ok: false,
        error: { code: 'transport-timeout', message: 'simulated constrained-link timeout', details: {} },
      },
    }),
  })
}

describe('web e2e: poor-connection budgets and recovery', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let cdp: CDPSession
  let transfers: Map<string, Transfer>
  const pageErrors: string[] = []
  const connectionWarnings: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, productionHistoryFixture(), SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 844)
    page.on('pageerror', (error) => { pageErrors.push(String(error)) })
    page.on('console', (message) => {
      if (/connection lost/i.test(message.text())) connectionWarnings.push(message.text())
    })
    cdp = await page.context().newCDPSession(page)
    transfers = await installTransferProbe(cdp)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'poor-connection browser teardown failed')
  })

  it('meets cold and warm Fast 3G boot budgets with one cached registration bundle', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-poor-connection-boot'))
    await throttle(cdp, 'fast-3g')
    const coldStarted = performance.now()
    await page.goto(scaffold.baseUrl, { waitUntil: 'load', timeout: 30_000 })
    await waitForShell(page)
    const coldMs = performance.now() - coldStarted
    const cold = appTransfers(transfers, scaffold.baseUrl)
    const coldBytes = cold.reduce((sum, transfer) => sum + (transfer.encodedBytes ?? 0), 0)
    const boot = cold.filter(transfer => new URL(transfer.url).pathname === '/plugins/boot.js')
    const individualPlugins = cold.filter((transfer) => {
      const path = new URL(transfer.url).pathname
      return path.startsWith('/plugins/') && path !== '/plugins/boot.js'
    })
    const index = cold.find(transfer => new URL(transfer.url).pathname === '/')

    console.info(`POOR_CONNECTION_RESULT ${JSON.stringify({
      scenario: 'fast-3g-cold',
      readyMs: Math.round(coldMs),
      encodedBytes: Math.round(coldBytes),
      transfers: cold.map(transfer => ({
        path: new URL(transfer.url).pathname,
        encodedBytes: transfer.encodedBytes,
        encoding: transfer.headers?.['content-encoding'],
      })),
    })}`)
    expect(coldMs).toBeLessThanOrEqual(COLD_BOOT_MAX_MS)
    expect(coldBytes).toBeLessThanOrEqual(COLD_BOOT_MAX_BYTES)
    expect(boot).toHaveLength(1)
    expect(boot[0]?.headers?.['content-encoding']).toBe('br')
    expect(boot[0]?.headers?.['cache-control']).toContain('immutable')
    expect(individualPlugins).toEqual([])
    expect(index?.headers?.['cache-control']).toBe('no-store')

    transfers.clear()
    const warmStarted = performance.now()
    await page.reload({ waitUntil: 'load', timeout: 30_000 })
    await waitForShell(page)
    const warmMs = performance.now() - warmStarted
    const warmImmutable = appTransfers(transfers, scaffold.baseUrl).filter((transfer) => {
      const path = new URL(transfer.url).pathname
      return path.startsWith('/assets/') || path === '/plugins/boot.js'
    })
    console.info(`POOR_CONNECTION_RESULT ${JSON.stringify({
      scenario: 'fast-3g-warm',
      readyMs: Math.round(warmMs),
      immutableTransfers: warmImmutable.map(transfer => ({
        path: new URL(transfer.url).pathname,
        encodedBytes: transfer.encodedBytes,
        cached: transfer.fromDiskCache === true || transfer.servedFromCache === true,
      })),
    })}`)
    expect(warmMs).toBeLessThanOrEqual(WARM_BOOT_MAX_MS)
    expect(warmImmutable.length).toBeGreaterThan(0)
    expect(warmImmutable.every(transfer =>
      transfer.fromDiskCache === true
      || transfer.servedFromCache === true
      || transfer.encodedBytes === 0)).toBe(true)
    expect(pageErrors).toEqual([])
  }, 60_000)

  it('recovers a timed-out production-sized history under 400 kbit/s and preserves it across reconnect', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-poor-connection-history'))
    if (page.url() === 'about:blank') {
      await throttle(cdp, 'fast-3g')
      await page.goto(scaffold.baseUrl, { waitUntil: 'load', timeout: 30_000 })
      await waitForShell(page)
    }
    let failFirstHistory = true
    await page.route('**/api/session.history', async (route) => {
      if (failFirstHistory) {
        failFirstHistory = false
        await fulfillTimeout(route)
        return
      }
      await route.continue()
    })
    await throttle(cdp, 'slow-400')
    const searchButton = page.getByRole('button', { name: 'Search sessions', exact: true })
    if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
    await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill('POOR_NETWORK_USER_1')
    const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await expect.poll(() => result.count(), { timeout: 30_000 }).toBe(1)
    await result.click()
    await page.getByText(/Failed to load history: simulated constrained-link timeout \(transport-timeout\)/)
      .waitFor({ timeout: 10_000 })

    transfers.clear()
    const historyStarted = performance.now()
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByText(`POOR_NETWORK_ASSISTANT_${String(HISTORY_TURNS)}`, { exact: false })
      .waitFor({ timeout: 30_000 })
    const historyMs = performance.now() - historyStarted
    const historyTransfer = [...transfers.values()].find(transfer =>
      transfer.method === 'session.history' && transfer.status === 200 && transfer.encodedBytes !== undefined)
    expect(historyTransfer).toBeDefined()
    const historyBytes = await bodyBytes(cdp, historyTransfer!)
    console.info(`POOR_CONNECTION_RESULT ${JSON.stringify({
      scenario: 'slow-400-history',
      readyMs: Math.round(historyMs),
      responseBytes: historyBytes,
      encodedBytes: Math.round(historyTransfer!.encodedBytes ?? 0),
      encoding: historyTransfer!.headers?.['content-encoding'],
    })}`)
    expect(historyBytes).toBeLessThanOrEqual(HISTORY_MAX_BYTES)
    expect(historyMs).toBeLessThanOrEqual(HISTORY_MAX_MS)

    for (let turn = HISTORY_TURNS - TAIL_TURNS + 1; turn <= HISTORY_TURNS; turn += 1) {
      await page.getByText(`POOR_NETWORK_USER_${String(turn)}`, { exact: false }).waitFor()
      await page.getByText(`POOR_NETWORK_ASSISTANT_${String(turn)}`, { exact: false }).waitFor()
    }
    const latestCall = page.locator(`[data-chat-call-id="poor-network-call-${String(HISTORY_TURNS)}"]`)
    await latestCall.getByRole('button').first().click()
    await page.getByText(`POOR_NETWORK_DETAIL_${String(HISTORY_TURNS)}`, { exact: false })
      .waitFor({ timeout: 10_000 })

    scaffold.breakEventStreams()
    await throttle(cdp, 'offline')
    await expect.poll(() => connectionWarnings.length, { timeout: 15_000 }).toBeGreaterThan(0)
    await page.getByText('Reconnecting… showing the last loaded messages', { exact: true })
      .waitFor({ timeout: 15_000 })
    await page.getByText(`POOR_NETWORK_ASSISTANT_${String(HISTORY_TURNS)}`, { exact: false }).waitFor()
    await throttle(cdp, 'slow-400')
    await page.getByText('Reconnecting… showing the last loaded messages', { exact: true })
      .waitFor({ state: 'hidden', timeout: 30_000 })
    await page.getByText(`POOR_NETWORK_USER_${String(HISTORY_TURNS)}`, { exact: false }).waitFor()
    await page.getByText(`POOR_NETWORK_ASSISTANT_${String(HISTORY_TURNS)}`, { exact: false }).waitFor()
    expect(pageErrors).toEqual([])
  }, 120_000)
})
