/** Shipped reporting defaults keep recorded feedback local even with collector configuration. */
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/reporting-disabled', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/feedback-command/session.v3.jsonl', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: shipped reporting stays disabled', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let collector: Server
  let directory: string
  let requests = 0

  beforeAll(async () => {
    collector = createServer((_request, response) => {
      requests++
      response.writeHead(200).end('{}')
    })
    collector.listen(0, '127.0.0.1')
    await once(collector, 'listening')
    const address = collector.address()
    if (address === null || typeof address === 'string') throw new Error('collector has no port')
    directory = await mkdtemp(join(tmpdir(), 'dsh-reporting-disabled-'))
    const overlay = join(directory, 'collector.patch.yml')
    await writeFile(overlay, [
      '- id: session-telemetry-otel',
      '  config:',
      '    mode: FEEDBACK_ONLY',
      '    exporter:',
      `      url: http://127.0.0.1:${String(address.port)}/v1/logs`,
      '    shutdownTimeoutMillis: 1000',
      '',
    ].join('\n'))
    scaffold = await launchWebScaffold({
      extraOverlayPath: overlay,
      replayFixture: FIXTURE,
      compareReplaySession: false,
      paceMs: 5,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      try {
        await browser?.close()
      } finally {
        await scaffold?.close()
      }
      expect(requests).toBe(0)
    } finally {
      if (collector?.listening) {
        await new Promise<void>((resolve, reject) => {
          collector.close((error) => {
            if (error === undefined) resolve()
            else reject(error)
          })
        })
      }
      if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    }
  })

  it('records feedback without constructing an outbound reporting pipeline', async () => {
    const prompts = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
    expect(prompts).toHaveLength(1)
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(prompts[0]!)
    await input.press('Enter')
    const sessionId = await settled
    await input.fill('/feedback Keep this feedback local.')
    await input.press('Enter')
    await page.getByText(/Feedback recorded for session/).waitFor()
    expect(scaffold.ctx.sessions.get(sessionId)?.snapshotEvents().filter(event => event.type === 'feedback/record'))
      .toMatchObject([{ data: { text: 'Keep this feedback local.' } }])
    expect(requests).toBe(0)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'ack.expected.md'),
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), MODE)
    await assertFixtureInventory(SNAPSHOT_DIR, ['ack.expected.md'])
  })
})
