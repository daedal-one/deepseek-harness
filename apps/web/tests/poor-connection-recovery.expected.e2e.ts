// @vitest-environment jsdom
// Assembled recovery snapshot: the real built client graph opens the keyless
// fixture session, surfaces one transport failure as a retryable history error,
// and reaches the same transcript after Retry without remounting the page.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

interface FixtureTiming {
  failNextHistory(): void
}

installAssembledBootEnv()

describe('assembled poor-connection recovery', () => {
  it('keeps a failed conversation open retryable and recovers in place', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    const waiting = await within(tree).findByText('Waiting for answer')
    const sessionRow = waiting.closest<HTMLElement>('[role="treeitem"]')
    if (sessionRow === null) throw new Error('fixture waiting state must belong to a Session row')
    const timing = (globalThis as Record<string, unknown>).__fxTiming as FixtureTiming | undefined
    if (timing === undefined) throw new Error('fixture timing hooks missing')
    timing.failNextHistory()
    fireEvent.click(sessionRow)

    const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 10_000 })
    expect({
      message: screen.getByText(/Failed to load history: fixture: simulated history transport failure/).textContent,
      action: retry.textContent,
    }).toMatchInlineSnapshot(`
      {
        "action": "Retry",
        "message": "Failed to load history: fixture: simulated history transport failure (gateway/internal)Retry",
      }
    `)

    fireEvent.click(retry)
    await waitFor(() => {
      expect(screen.getAllByText('fixture history message', { exact: false }).length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    }, { timeout: 10_000 })
  }, 30_000)
})
