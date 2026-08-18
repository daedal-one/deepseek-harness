// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function props(list: PluginInventorySettingsTabInjected['list']): PluginInventorySettingsTabProps {
  return {
    t,
    list,
  } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  entries: [
    {
      entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', author: 'Shigma',
      description: 'Reloads changed Cordis plugins.', version: '1.0.2', enabled: true, fiberPhase: 'active',
    },
    {
      entryId: 'pending', moduleName: 'cordis:pending-name', author: null,
      description: null, version: null, enabled: true, fiberPhase: 'pending',
    },
    {
      entryId: 'loading', moduleName: '@fixture/loading-name', author: null,
      description: null, version: null, enabled: true, fiberPhase: 'loading',
    },
    {
      entryId: 'failed', moduleName: '@fixture/failed-name', author: null,
      description: null, version: null, enabled: true, fiberPhase: 'failed',
    },
    {
      entryId: 'unloading', moduleName: '@fixture/unloading-name', author: null,
      description: null, version: null, enabled: true, fiberPhase: 'unloading',
    },
    {
      entryId: 'unobserved', moduleName: '@fixture/unobserved-name', author: null,
      description: null, version: null, enabled: true, fiberPhase: null,
    },
    {
      entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', author: 'DeepSeek',
      description: 'Chooses a workspace directory with the native picker.', version: '0.1.0-rc.5',
      enabled: false, fiberPhase: null,
    },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: en.filterState })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    const inventory = screen.getByRole('list')
    expect(within(inventory).getAllByRole('listitem')).toHaveLength(7)
    expect(within(inventory).getAllByText(en.enabledTag)).toHaveLength(6)
    expect(within(inventory).getByText(en.disabledTag)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(within(inventory).getByText(value)).toBeTruthy()
    }
    expect(screen.getByText('Reloads changed Cordis plugins.')).toBeTruthy()
    expect(screen.getByText('Shigma')).toBeTruthy()
    expect(screen.getByText('1.0.2')).toBeTruthy()
    const active = screen.getByRole('button', {
      name: 'hmr, Reloads changed Cordis plugins., Author: Shigma, Version: 1.0.2, Mounted, Enabled',
    })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', {
      name: 'directory-picker-native, Chooses a workspace directory with the native picker., Author: DeepSeek, Version: 0.1.0-rc.5, Disabled',
    }))
    expect(within(inventory).getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(within(inventory).queryByText(en.unobserved)).toBeNull()
  })

  it('filters by module name, Loader entry id, or package metadata', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'changed cordis' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: '0.1.0-rc.5' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('filters locally by configuration or Cordis state and composes with search', async () => {
    const list = vi.fn(async () => SNAPSHOT)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    const filter = await screen.findByRole('combobox', { name: en.filterState })
    const search = screen.getByRole('searchbox', { name: en.search })

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'All states',
      'Enabled',
      'Disabled',
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ])
    for (const [value, count] of [
      ['enabled', 6],
      ['disabled', 1],
      ['active', 1],
      ['pending', 1],
      ['loading', 1],
      ['failed', 1],
      ['unloading', 1],
      ['unobserved', 1],
      ['all', 7],
    ] as const) {
      fireEvent.change(filter, { target: { value } })
      expect(screen.queryAllByRole('listitem')).toHaveLength(count)
      expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe(String(count))
    }

    fireEvent.change(filter, { target: { value: 'disabled' } })
    fireEvent.change(search, { target: { value: 'hmr' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
    fireEvent.change(search, { target: { value: 'directory-picker' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(list).toHaveBeenCalledOnce()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})
