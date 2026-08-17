// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { BrandingRowComponentProps, BrandingSnapshot } from '@deepseek-ai/dsh-client-ui-branding/client'
import { BrandingRow } from '../src/client/BrandingRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: BrandingRowComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key
const PNG = 'data:image/png;base64,YQ=='

const sessionState: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
}
const workspaceState: WorkspaceListState = {
  items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  baselinesReady: true, recentWorkspaceId: undefined,
}
const useSessions: BrandingRowComponentProps['useSessions'] = select => select(sessionState)
const useWorkspaces: BrandingRowComponentProps['useWorkspaces'] = select => select(workspaceState)

function mount(snapshot: BrandingSnapshot = { name: 'Studio', logo: PNG, revision: 1 }) {
  const setName = vi.fn(() => Promise.resolve())
  const resetName = vi.fn(() => Promise.resolve())
  const setLogo = vi.fn(() => Promise.resolve())
  const resetLogo = vi.fn(() => Promise.resolve())
  const view = render(
    <BrandingRow
      t={t}
      useSessions={useSessions}
      useWorkspaces={useWorkspaces}
      useBranding={select => select(snapshot)}
      setName={setName}
      resetName={resetName}
      setLogo={setLogo}
      resetLogo={resetLogo}
    />,
  )
  return { ...view, setName, resetName, setLogo, resetLogo }
}

describe('BrandingRow', () => {
  it('saves the edited name and exposes both reset actions', async () => {
    const view = mount()
    const input = view.getByRole('textbox', { name: 'Product name' })
    fireEvent.change(input, { target: { value: 'New studio' } })
    fireEvent.click(view.getByRole('button', { name: 'Save name' }))
    expect(view.setName).toHaveBeenCalledWith('New studio')
    fireEvent.click(view.getByRole('button', { name: 'Use default name' }))
    expect(view.resetName).toHaveBeenCalledOnce()
    fireEvent.click(view.getByRole('button', { name: 'Use default logo' }))
    expect(view.resetLogo).toHaveBeenCalledOnce()
    await Promise.resolve()
  })

  it('encodes an accepted upload and reports an unsupported format', async () => {
    const view = mount({ name: 'the harness', revision: 0 })
    const picker = view.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const png = {
      type: 'image/png', size: 1,
      arrayBuffer: () => Promise.resolve(new Uint8Array([97]).buffer),
    } as File
    fireEvent.change(picker, { target: { files: [png] } })
    await waitFor(() => { expect(view.setLogo).toHaveBeenCalledWith(PNG) })

    const svg = { type: 'image/svg+xml', size: 1 } as File
    fireEvent.change(picker, { target: { files: [svg] } })
    expect((await view.findByRole('alert')).textContent).toContain('Choose a PNG')
  })

  it('reports a durable write failure', async () => {
    const view = mount()
    view.setName.mockRejectedValueOnce(new Error('offline'))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Offline name' } })
    fireEvent.click(view.getByRole('button', { name: 'Save name' }))
    expect((await view.findByRole('alert')).textContent).toContain('could not be saved')
  })
})
