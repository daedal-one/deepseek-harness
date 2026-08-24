import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

describe('web e2e: client plugin load recovery', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let attempts = 0
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US' })
    await page.route('**/plugins/boot.js?rev=*', async (route) => {
      attempts++
      if (attempts === 1) {
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('settles the phone shell after the first registration-bundle request fails', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-client-plugin-load-recovery'))
    expect(attempts).toBe(2)
    expect(await page.getByText('Failed to load plugins').count()).toBe(0)
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
