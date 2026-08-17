// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentModelsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { AgentsSection } from '../src/client/AgentsSection.tsx'
import { agentEn } from '../src/client/agent-locales.ts'

const snapshot: AgentModelsSnapshot = {
  provider: 'openrouter',
  writable: true,
  revision: 7,
  targets: [
    {
      id: 'main' as never,
      label: 'Main agent',
      selection: { model: 'model-a', reasoningEffort: 'high' },
      defaultSelection: { model: 'model-a', reasoningEffort: 'high' },
      overridden: false,
    },
    {
      id: 'reviewer' as never,
      label: 'Reviewer',
      selection: { model: 'model-b' },
      defaultSelection: { model: 'model-a', reasoningEffort: 'high' },
      overridden: true,
    },
  ],
  models: [
    {
      id: 'model-a',
      name: 'Model A',
      reasoningEfforts: [
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'Extra high' },
      ],
    },
    {
      id: 'model-b',
      name: 'Model B',
      reasoningEfforts: [],
    },
  ],
}

const t = (key: keyof typeof agentEn): string => agentEn[key]

afterEach(cleanup)

describe('AgentsSection', () => {
  it('renders main and named Agent selections from the OpenRouter directory', async () => {
    const { container } = render(<AgentsSection
      list={() => Promise.resolve(snapshot)}
      save={vi.fn()}
      reset={vi.fn()}
      t={t}
    />)

    expect(await screen.findByText('Main agent')).toBeTruthy()
    expect(screen.getByText('Reviewer')).toBeTruthy()
    expect(screen.getAllByText('openrouter')).toHaveLength(2)
    const reviewer = container.querySelector<HTMLElement>('[data-agent-id="reviewer"]')
    expect(reviewer).not.toBeNull()
    if (reviewer === null) throw new Error('reviewer card is missing')
    const modelSelect = within(reviewer).getByLabelText(agentEn.model)
    expect(modelSelect).toBeInstanceOf(HTMLSelectElement)
    if (!(modelSelect instanceof HTMLSelectElement)) throw new Error('reviewer model selector is missing')
    expect(modelSelect.value).toBe('model-b')
    expect(within(reviewer).getByText(agentEn.overrideTag)).toBeTruthy()
  })

  it('saves a model and exact reasoning effort with the displayed revision', async () => {
    const saved = {
      ...snapshot,
      revision: 8,
      targets: snapshot.targets.map(target => target.id === ('main' as never)
        ? { ...target, selection: { model: 'model-a', reasoningEffort: 'xhigh' }, overridden: true }
        : target),
    } satisfies AgentModelsSnapshot
    const save = vi.fn(() => Promise.resolve(saved))
    const { container } = render(<AgentsSection
      list={() => Promise.resolve(snapshot)}
      save={save}
      reset={vi.fn()}
      t={t}
    />)
    await screen.findByText('Main agent')
    const main = container.querySelector('[data-agent-id="main"]') as HTMLElement
    fireEvent.change(within(main).getByLabelText(agentEn.reasoning), { target: { value: 'xhigh' } })
    fireEvent.click(within(main).getByRole('button', { name: agentEn.apply }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith('main', 'model-a', 'xhigh', 7)
    })
    expect(await screen.findByText(agentEn.saved)).toBeTruthy()
    expect(within(container.querySelector('[data-agent-id="main"]') as HTMLElement)
      .getByText(agentEn.overrideTag)).toBeTruthy()
  })

  it('restores a named Agent deployment default through compare-and-swap', async () => {
    const resetSnapshot = {
      ...snapshot,
      revision: 8,
      targets: snapshot.targets.map(target => target.id === ('reviewer' as never)
        ? { ...target, selection: target.defaultSelection, overridden: false }
        : target),
    } satisfies AgentModelsSnapshot
    const reset = vi.fn(() => Promise.resolve(resetSnapshot))
    const { container } = render(<AgentsSection
      list={() => Promise.resolve(snapshot)}
      save={vi.fn()}
      reset={reset}
      t={t}
    />)
    await screen.findByText('Reviewer')
    const reviewer = container.querySelector('[data-agent-id="reviewer"]') as HTMLElement
    fireEvent.click(within(reviewer).getByRole('button', { name: agentEn.reset }))

    await waitFor(() => { expect(reset).toHaveBeenCalledWith('reviewer', 7) })
    expect(await screen.findByText(agentEn.saved)).toBeTruthy()
    expect(within(container.querySelector('[data-agent-id="reviewer"]') as HTMLElement)
      .getByText(agentEn.defaultTag)).toBeTruthy()
  })

  it('disables changes when settings are read-only', async () => {
    const { container } = render(<AgentsSection
      list={() => Promise.resolve({ ...snapshot, writable: false })}
      save={vi.fn()}
      reset={vi.fn()}
      t={t}
    />)
    expect(await screen.findByText(agentEn.readOnly)).toBeTruthy()
    const main = container.querySelector('[data-agent-id="main"]') as HTMLElement
    const modelSelect = within(main).getByLabelText(agentEn.model)
    const applyButton = within(main).getByRole('button', { name: agentEn.apply })
    if (!(modelSelect instanceof HTMLSelectElement)) throw new Error('main model selector is missing')
    if (!(applyButton instanceof HTMLButtonElement)) throw new Error('main apply button is missing')
    expect(modelSelect.disabled).toBe(true)
    expect(applyButton.disabled).toBe(true)
  })

  it('reports a stale write without claiming that it reloaded', async () => {
    const save = vi.fn(() => Promise.reject(new Error('settings revision changed')))
    const { container } = render(<AgentsSection
      list={() => Promise.resolve(snapshot)}
      save={save}
      reset={vi.fn()}
      t={t}
    />)
    await screen.findByText('Main agent')
    const main = container.querySelector('[data-agent-id="main"]') as HTMLElement
    fireEvent.change(within(main).getByLabelText(agentEn.reasoning), { target: { value: 'xhigh' } })
    fireEvent.click(within(main).getByRole('button', { name: agentEn.apply }))

    expect(await screen.findByText(agentEn.stale)).toBeTruthy()
  })
})
