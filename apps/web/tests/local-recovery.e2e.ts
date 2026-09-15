/** Recovery forms submit through the browser's navigation and referrer-policy processing. */
import { once } from 'node:events'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createRecoveryProxy } from '../../../scripts/dev-proxy.ts'
import type { RecoveryConfig, RecoveryControls } from '../../../scripts/dev-proxy-runtime.ts'

it('submits each authenticated recovery form with its own origin', async () => {
  const token = 'a'.repeat(64)
  const actions: string[] = []
  const controls: RecoveryControls = {
    status: () => ({ active: 'current', running: false, commit: 'a'.repeat(40), goodCommit: 'b'.repeat(40), error: null }),
    openPath: () => '/', targetPort: () => undefined,
    use: async (target) => { actions.push(target) },
    markGood: async () => { actions.push('mark') },
    close: async () => {}, interrupt: async () => {},
  }
  // Browser-only controls acquire no backend, checkout, or data directory.
  const config: RecoveryConfig = { repository: '/unused', home: '/unused', state: '/unused',
    node: process.execPath, pnpm: 'pnpm', path: process.env.PATH ?? '', port: 0, backendPort: 0,
    trustedHosts: [], startupTimeoutMs: 1, stopTimeoutMs: 1 }
  const proxy = createRecoveryProxy(config, token, controls)
  try {
    proxy.server.listen(0, '127.0.0.1')
    await once(proxy.server, 'listening')
    const address = proxy.server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing recovery listener')
    const origin = `http://127.0.0.1:${address.port}`
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.goto(`${origin}/_dev?token=${token}`)
      expect(page.url()).toBe(`${origin}/_dev`)
      for (const [label, route, action] of [
        ['Use last good', 'use-good', 'good'],
        ['Use current', 'use-current', 'current'],
        ['Mark current good', 'mark-good', 'mark'],
      ] as const) {
        if (action === 'mark') await page.getByRole('checkbox').check()
        const submitted = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === `/_dev/${route}`)
        await page.getByRole('button', { name: label, exact: true }).click()
        const response = await submitted
        expect(response.request().headers()['origin']).toBe(origin)
        expect(response.status()).toBe(303)
        await expect.poll(() => actions.at(-1)).toBe(action)
        await page.waitForURL(`${origin}/_dev`)
        await page.getByRole('button', { name: 'Use current', exact: true }).waitFor()
        await expect.poll(() => page.getByRole('button', { name: 'Use current', exact: true }).isEnabled()).toBe(true)
      }
      expect(actions).toEqual(['good', 'current', 'mark'])
    } finally { await browser.close() }
  } finally { await proxy.close() }
})
