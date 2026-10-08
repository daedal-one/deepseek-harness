// Which conversation tabs own the transcript width handles. The handles drag
// the shared content-width axis, which only the Chat View lays its content on,
// so no other view tab may show a strip over its own full-bleed surface.
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = createChatScrollFixture({
  markerPrefix: 'TAB_HANDLES',
  title: 'VIEW_TAB_WIDTH_HANDLES long session',
  turns: 12,
})
const SEED_ID = 'view-tab-width-handles-web-e2e'
/** Tabs whose View does not lay content on the shared width axis. */
const BLEED_TABS = ['Trajectory', 'Info', 'Prompt'] as const
/** Id for the control override injected into the page, so it can be lifted again. */
const CONTROL_STYLE_ID = 'view-tab-width-handles-control'
/** The control: restore the strips the surface rule hides, without a rebuild. */
const CONTROL_CSS = '[data-width-handle] { display: block !important; }'

/** The width-handle strips as the browser lays them out in the current tab. */
interface HandleState {
  count: number
  displayed: number
  cursor: string
}

/**
 * Read the width-handle strips in the conversation column.
 * @param page - the page under test.
 * @returns the mounted strip count, how many the browser displays, and one strip's cursor.
 */
function handleState(page: Page): Promise<HandleState> {
  return page.evaluate(() => {
    const strips = [...document.querySelectorAll<HTMLElement>('[data-width-handle]')]
    return {
      count: strips.length,
      displayed: strips.filter(strip => getComputedStyle(strip).display !== 'none').length,
      cursor: strips[0] === undefined ? '' : getComputedStyle(strips[0]).cursor,
    }
  })
}

/**
 * Show one view tab and let the tab's View commit.
 * @param page - the page under test.
 * @param tab - the tab label to click.
 */
async function showTab(page: Page, tab: string): Promise<void> {
  await page.getByRole('tab', { name: tab, exact: true }).click()
  await page.evaluate(() => new Promise<void>((settle) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { settle() }) })
  }))
}

/**
 * Open the seeded session from the sidebar search.
 *
 * Cold summaries carry the temp workspace's basename, so the persisted first
 * message is the stable identity to search for, and the query itself drives the
 * lazy content-index reconciliation. Hand-rolled polling because `expect.poll`
 * is test-scoped and this runs in `beforeAll`.
 * @param page - the page under test.
 */
async function openSeededSession(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  for (;;) {
    if (await results.count() === 1) break
    if (Date.now() > deadline) throw new Error('seeded session never appeared in the sidebar search results')
    await page.waitForTimeout(200)
  }
  await results.click()
}

describe('web e2e: width handles across view tabs', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page)
    await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText(FIXTURE.markers.assistant(1), { exact: false }).first().waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the strips only in Chat and hides them for every full-bleed View', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-view-tab-width-handles'))
    await expect.poll(async () => (await handleState(page)).displayed, { timeout: 10_000 }).toBe(2)
    expect(await handleState(page)).toMatchObject({ count: 2, cursor: 'col-resize' })

    for (const tab of BLEED_TABS) {
      await showTab(page, tab)
      await expect.poll(async () => (await handleState(page)).displayed, { timeout: 10_000 }).toBe(0)
      // The strips stay mounted for the active phase; the surface rule, not a
      // missing View, is what keeps them off these tabs.
      expect((await handleState(page)).count).toBe(2)
    }

    // Control: on a full-bleed tab, overriding the surface rule in the page
    // must reveal the same mounted strips, so the zeros above measure the rule
    // rather than an element that never laid out.
    await showTab(page, 'Prompt')
    await page.evaluate(({ id, css }) => {
      const style = document.createElement('style')
      style.id = id
      style.textContent = css
      document.head.append(style)
    }, { id: CONTROL_STYLE_ID, css: CONTROL_CSS })
    try {
      await expect.poll(async () => (await handleState(page)).displayed, { timeout: 10_000 }).toBe(2)
    } finally {
      await page.evaluate((id) => { document.getElementById(id)?.remove() }, CONTROL_STYLE_ID)
    }
    await expect.poll(async () => (await handleState(page)).displayed, { timeout: 10_000 }).toBe(0)

    await showTab(page, 'Chat')
    await expect.poll(async () => (await handleState(page)).displayed, { timeout: 10_000 }).toBe(2)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
