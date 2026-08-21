// @vitest-environment jsdom
/**
 * The session-rename assembly chain on SlotTestRuntime (real apply, real
 * WorkspaceBrowser occupying the sidebar hole): row menu → rename dialog →
 * the injected renameSession hop (sessions.binding → ISession.rename) → on
 * the accepted unary response the dialog closes and the row re-labels from
 * the list state — no push-frame wait. Coverage split: the assembled-app
 * snapshot (apps/web/tests/session-actions.snapshot.ts) pins the full-app
 * transcript; the
 * verb's wire behavior stays with the runtime package
 * (session.spec.ts#rename), the dialog's own arms with rows.spec /
 * workspace-browser.spec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ISession, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'

// The service reads its initial locale from the browser; these specs pin the
// browser they assume (the zh dictionary now carries the shared English copy).
usePinnedBrowserLanguages('zh-CN')

const SID = 's1' as SessionId

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Runtime with the locale face installed (the browser entry declares `locale:` — zh default backs the t seat). */
async function createRuntime(): Promise<SlotTestRuntime> {
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  return runtime
}

/** Test-owned sidebar shell role: declares and renders the browsing region. */
type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function SidebarFrame({ renderSlot }: FrameProps) {
  return <>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</>
}

describe('session rename through the assembled browser', () => {
  it('renames via the row menu: binding.session.rename fires, the dialog closes, the row re-labels from the list', async () => {
    const runtime = await createRuntime()
    const rename = vi.fn<ISession['rename']>(async title => ({
      ok: true, value: { title: title.trim().replace(/\s+/g, ' '), seq: 7 },
    }))
    await runtime.sessions.add({
      id: SID,
      summary: { title: 'Old Title', displayTitle: 'Old Title', cwd: '/w/alpha' },
      session: { rename },
    })
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'w1' as WorkspaceId, title: 'alpha', path: '/w/alpha',
        sessionIds: [SID], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }] as never
    })
    await runtime.root.declare(
      { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    // The current session's group auto-expands; open the row's action menu.
    const row = (await view.findByText('Old Title')).closest('[role="treeitem"]')!
    fireEvent.click(within(row as HTMLElement).getByLabelText('Session actions for Old Title'))
    fireEvent.click(view.getByRole('menuitem', { name: 'Rename', hidden: true }))

    // The dialog seeds from the current title; submit a padded value.
    const input = await view.findByLabelText('Session name') as HTMLInputElement
    expect(input.value).toBe('Old Title')
    fireEvent.change(input, { target: { value: '  Fork   experiment log  ' } })
    fireEvent.click(view.getByRole('button', { name: 'Rename' }))

    // The injected hop reached the session face with the edge-trimmed draft
    // (the dialog trims edges; interior normalization is host-side).
    await waitFor(() => { expect(rename).toHaveBeenCalledWith('Fork   experiment log') })
    // Acceptance closes the dialog without any push-frame wait.
    await waitFor(() => { expect(view.queryByLabelText('Session name')).toBeNull() })
    // The manager lands the uncommitted echo in the list store (its own package
    // tests own that hop); the row just re-labels from list state alone.
    await runtime.sessions.updateSummary(SID, { displayTitle: 'Fork experiment log', title: 'Fork experiment log' })
    await view.findByText('Fork experiment log')
    expect(view.queryByText('Old Title')).toBeNull()
    await runtime.dispose()
  })

  it('a rejected rename keeps the dialog open with the error surfaced', async () => {
    const runtime = await createRuntime()
    const rename = vi.fn<ISession['rename']>(async () => ({
      ok: false, error: { code: 'internal', message: 'title write failed', details: {} },
    }))
    await runtime.sessions.add({
      id: SID,
      summary: { title: 'Old Title', displayTitle: 'Old Title', cwd: '/w/alpha' },
      session: { rename },
    })
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'w1' as WorkspaceId, title: 'alpha', path: '/w/alpha',
        sessionIds: [SID], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }] as never
    })
    await runtime.root.declare(
      { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    await runtime.flush()

    const row = (await view.findByText('Old Title')).closest('[role="treeitem"]')!
    fireEvent.click(within(row as HTMLElement).getByLabelText('Session actions for Old Title'))
    fireEvent.click(view.getByRole('menuitem', { name: 'Rename', hidden: true }))
    const input = await view.findByLabelText('Session name')
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.click(view.getByRole('button', { name: 'Rename' }))

    // Failure: the injected hop rethrows the business error; the dialog
    // stays open with the alert and the row keeps its title.
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('title write failed')
    expect(view.getByLabelText('Session name')).toBeTruthy()
    expect(view.getByText('Old Title')).toBeTruthy()
    await runtime.dispose()
  })
})
