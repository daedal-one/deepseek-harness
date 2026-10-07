// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import {
  bindSnapshotSelector, makeTranslate, RemoteError, TestRemote, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { OpenRouterSpendFailure, OpenRouterSpendSnapshot } from '@deepseek-ai/dsh-openrouter-spend/types'
import type { SessionInfoFailure, SessionInfoSnapshot } from '@deepseek-ai/dsh-session-info/types'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject, NS } from '../src/client/index.ts'
import { InfoView, type InfoViewProps } from '../src/client/InfoView.tsx'
import { createInfoStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

usePinnedBrowserLanguages('en-US')

const t = makeTranslate(en)
const SID = 'info-session' as SessionId
const EPOCH = 1_758_360_000_000

/** Every amount keeps a non-zero last digit, so no row renders '0 … USD'. */
const KEY = {
  label: 'sk-or-main',
  usageUsd: 1.25,
  usageDailyUsd: 0.375,
  usageWeeklyUsd: 2.75,
  usageMonthlyUsd: 3.125,
  limitUsd: 10,
  limitRemainingUsd: 0.625,
  isFreeTier: false,
}

const SPEND: OpenRouterSpendSnapshot = {
  key: KEY,
  session: { provider: 'openrouter', model: 'vendor/model-x', costUsd: 0.03 },
  fetchedAt: EPOCH,
}

const INFO: SessionInfoSnapshot = {
  session: {
    sessionId: SID,
    title: 'Fixture session',
    agentPreset: 'default',
    model: { provider: 'openrouter', model: 'vendor/model-x' },
    cwd: '/work/fixture',
    turns: 4,
    steps: 9,
  },
  summary: 'Fixture summary',
  workspace: { workspaceId: 'ws-1', path: '/work/fixture', title: 'Fixture workspace' },
  environment: {
    placement: 'host',
    environmentId: 'host-1a2b3c4d',
    platform: 'linux',
    arch: 'x64',
    release: '7.0.0-fixture',
    node: 'v24.0.0',
    home: '/home/fixture',
  },
  policies: {
    sandboxMode: 'workspace-write',
    sandboxDefault: 'read-only',
    workspaceRoot: '/work/fixture',
    approvalPolicy: 'ask',
    approvalDefault: 'ask',
    permissionPreset: 'workspace-write',
    permissionPresetDescription: 'Write inside the workspace.',
    canChangePermission: false,
  },
  readAt: EPOCH,
}

type InfoStoreInstance = ReturnType<ReturnType<typeof createInfoStore>['create']>
type InjectFactory = (
  sessionId: SessionId,
  actions: InfoStoreInstance['actions'],
) => { loadInfo: () => void; loadSpend: () => void }

/** Feed the view its composed seats directly; the renderer is not involved. */
function viewProps(store: InfoStoreInstance, loadInfo: () => void, loadSpend: () => void): InfoViewProps {
  return { loadInfo, loadSpend, useStore: bindSnapshotSelector(store), t } as unknown as InfoViewProps
}

/** Mark both readings settled so the view renders every section. */
function settled(info: SessionInfoSnapshot = INFO, spend: OpenRouterSpendSnapshot = SPEND): InfoStoreInstance {
  const store = createInfoStore().create()
  store.actions.infoSucceed(info)
  store.actions.spendSucceed(spend)
  return store
}

afterEach(cleanup)

describe('InfoView', () => {
  it('shows the loading state and reads both sources once on mount', () => {
    const store = createInfoStore().create()
    const loadInfo = vi.fn()
    const loadSpend = vi.fn()
    const view = render(<InfoView {...viewProps(store, loadInfo, loadSpend)} />)
    expect(screen.getByText(en['state.loading'])).toBeTruthy()
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: en['action.refresh'] })).toBeTruthy()
    expect(loadInfo).toHaveBeenCalledOnce()
    expect(loadSpend).toHaveBeenCalledOnce()
  })

  it('renders session, workspace, environment, and policy facts from the settled reading', () => {
    const view = render(<InfoView {...viewProps(settled(), vi.fn(), vi.fn())} />)

    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('false')
    // The Summary block renders first, ahead of the Session block.
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual([
        en['heading.summary'],
        en['heading.session'],
        en['heading.workspace'],
        en['heading.environment'],
        en['heading.policies'],
        en['heading.spend'],
      ])
    expect(screen.getByText('Fixture summary')).toBeTruthy()
    expect(screen.getByText(en['heading.session'])).toBeTruthy()
    expect(screen.getByText(SID)).toBeTruthy()
    expect(screen.getByText('Fixture session')).toBeTruthy()
    expect(screen.getByText('default')).toBeTruthy()
    expect(screen.getAllByText('vendor/model-x').length).toBeGreaterThan(0)
    expect(screen.getAllByText('openrouter').length).toBeGreaterThan(0)
    expect(screen.getAllByText('/work/fixture').length).toBeGreaterThan(0)
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()

    expect(screen.getByText(en['heading.workspace'])).toBeTruthy()
    expect(screen.getByText('Fixture workspace')).toBeTruthy()
    expect(screen.getByText('ws-1')).toBeTruthy()

    expect(screen.getByText(en['heading.environment'])).toBeTruthy()
    expect(screen.getByText(en['placement.host'])).toBeTruthy()
    expect(screen.getByText('host-1a2b3c4d')).toBeTruthy()
    expect(screen.getByText('linux · x64')).toBeTruthy()
    expect(screen.getByText('7.0.0-fixture')).toBeTruthy()
    expect(screen.getByText('v24.0.0')).toBeTruthy()
    expect(screen.getByText('/home/fixture')).toBeTruthy()

    expect(screen.getByText(en['heading.policies'])).toBeTruthy()
    expect(screen.getAllByText('workspace-write').length).toBeGreaterThan(0)
    expect(screen.getByText('read-only')).toBeTruthy()
    expect(screen.getByText('Write inside the workspace.')).toBeTruthy()
    expect(screen.getAllByText('ask')).toHaveLength(2)
    expect(screen.getByText(en['value.no'])).toBeTruthy()
    expect(screen.getByText(/Read at /)).toBeTruthy()
  })

  it('renders the spend rows and the session estimate for a priced model', () => {
    render(<InfoView {...viewProps(settled(), vi.fn(), vi.fn())} />)

    expect(screen.getByText(en['heading.spend'])).toBeTruthy()
    expect(screen.getByText(en['spend.key'])).toBeTruthy()
    expect(screen.getByText(KEY.label)).toBeTruthy()
    expect(screen.queryByText(en['spend.tag.freeTier'])).toBeNull()
    expect(screen.getByText('1.25 USD')).toBeTruthy()
    expect(screen.getByText('0.375 USD')).toBeTruthy()
    expect(screen.getByText('2.75 USD')).toBeTruthy()
    expect(screen.getByText('3.125 USD')).toBeTruthy()
    expect(screen.getByText('10.00 USD')).toBeTruthy()
    expect(screen.getByText('0.625 USD')).toBeTruthy()
    expect(screen.getByText(en['spend.session'])).toBeTruthy()
    expect(screen.getByText('0.03 USD')).toBeTruthy()
    expect(screen.getByText(/Spend read at /)).toBeTruthy()
  })

  it('states an explicit absence for an unregistered workspace and unset policy values', () => {
    render(<InfoView {...viewProps(settled({
      ...INFO,
      workspace: null,
      policies: {
        sandboxMode: null,
        sandboxDefault: null,
        workspaceRoot: null,
        approvalPolicy: null,
        approvalDefault: null,
        permissionPreset: null,
        permissionPresetDescription: null,
        canChangePermission: null,
      },
    }), vi.fn(), vi.fn())} />)

    expect(screen.getByText(en['workspace.none'])).toBeTruthy()
    expect(screen.getAllByText(en['value.unavailable']).length).toBeGreaterThanOrEqual(6)
  })

  it('states the absence when the summary is null', () => {
    render(<InfoView {...viewProps(settled({ ...INFO, summary: null }), vi.fn(), vi.fn())} />)

    expect(screen.getByText(en['heading.summary'])).toBeTruthy()
    expect(screen.getByText(en['summary.none'])).toBeTruthy()
  })

  it('marks a free-tier key and renders both limit rows as unlimited when no limit is configured', () => {
    render(<InfoView {...viewProps(settled(INFO, {
      ...SPEND,
      key: { ...KEY, label: 'sk-or-free', isFreeTier: true, limitUsd: null, limitRemainingUsd: null },
    }), vi.fn(), vi.fn())} />)

    expect(screen.getByText('sk-or-free')).toBeTruthy()
    expect(screen.getByText(en['spend.tag.freeTier'])).toBeTruthy()
    expect(screen.getAllByText(en['money.none'])).toHaveLength(2)
  })

  it('renders the unpriceable wording and never a fabricated zero for an unpriced model', () => {
    const view = render(<InfoView {...viewProps(settled(INFO, {
      ...SPEND,
      session: { ...SPEND.session!, costUsd: null },
    }), vi.fn(), vi.fn())} />)
    expect(screen.getByText(en['spend.sessionUnpriceable'])).toBeTruthy()
    expect(view.queryByText('0 USD')).toBeNull()
    expect(view.queryByText('0.00 USD')).toBeNull()
  })

  it('degrades the spend block to its stated failure without failing the view', () => {
    const store = createInfoStore().create()
    store.actions.infoSucceed(INFO)
    store.actions.spendFail({ reason: 'unauthorized', detail: 'host detail' })
    const view = render(<InfoView {...viewProps(store, vi.fn(), vi.fn())} />)

    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByText(en['heading.policies'])).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(en['failure.unauthorized'])
    expect(view.queryByText('host detail')).toBeNull()
  })

  it('renders the info failure as the view failure', () => {
    const store = createInfoStore().create()
    store.actions.infoFail({ reason: 'session-unavailable', detail: 'host detail' })
    const view = render(<InfoView {...viewProps(store, vi.fn(), vi.fn())} />)

    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('alert').textContent).toBe(en['failure.session-unavailable'])
    expect(view.queryByText('host detail')).toBeNull()
    expect(screen.queryByText(en['heading.session'])).toBeNull()
  })

  it('re-reads both sources when the refresh button is clicked', () => {
    const loadInfo = vi.fn()
    const loadSpend = vi.fn()
    render(<InfoView {...viewProps(settled(), loadInfo, loadSpend)} />)
    fireEvent.click(screen.getByRole('button', { name: en['action.refresh'] }))
    expect(loadInfo).toHaveBeenCalledTimes(2)
    expect(loadSpend).toHaveBeenCalledTimes(2)
  })

  it('matches the keyless expected output for limits, priced and unpriceable sessions, and failure', async () => {
    const priced = render(<InfoView {...viewProps(settled(), vi.fn(), vi.fn())} />)
    const configuredLimit = priced.getByText(en['spend.row.limitConfigured']).nextElementSibling?.textContent
    const remainingLimit = priced.getByText(en['spend.row.limitRemaining']).nextElementSibling?.textContent
    const sessionPrice = priced.getByText('0.03 USD').textContent
    priced.unmount()

    const unpriceable = render(<InfoView {...viewProps(settled(INFO, {
      ...SPEND,
      key: { ...KEY, limitUsd: null, limitRemainingUsd: null },
      session: { ...SPEND.session!, costUsd: null },
    }), vi.fn(), vi.fn())} />)
    const unlimited = unpriceable.getAllByText(en['money.none'])
    const unpriceableText = unpriceable.getByText(en['spend.sessionUnpriceable']).textContent
    unpriceable.unmount()

    const spendFailed = createInfoStore().create()
    spendFailed.actions.infoSucceed(INFO)
    spendFailed.actions.spendFail({ reason: 'unauthorized', detail: 'fixture unauthorized' })
    const failedView = render(<InfoView {...viewProps(spendFailed, vi.fn(), vi.fn())} />)
    const failure = failedView.getByRole('alert').textContent
    expect(failedView.queryByText('fixture unauthorized')).toBeNull()

    const output = [
      `configured-limit: ${configuredLimit}`,
      `remaining-limit: ${remainingLimit}`,
      `session-price: ${sessionPrice}`,
      `unlimited-configured-limit: ${unlimited[0]?.textContent}`,
      `unlimited-remaining-limit: ${unlimited[1]?.textContent}`,
      `unpriceable-session: ${unpriceableText}`,
      `failure: ${failure}`,
      '',
    ].join('\n')
    const expected = await readFile(resolve(process.cwd(), 'packages/client/ui-session-info/tests/info-view.expected.md'), 'utf8')
    expect(output).toBe(expected)
  })
})

describe('session info plugin wiring', () => {
  const bench = async () => {
    const ctx = new Context()
    const slotsFiber = ctx.plugin(SlotRegistry)
    await slotsFiber.await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const readInfo = vi.fn()
    const readSpend = vi.fn()
    new TestRemote(ctx, { sessionInfo: { read: readInfo }, openrouterSpend: { read: readSpend } })
    return { ctx, slots: ctx.get('slots') as SlotRegistry, readInfo, readSpend }
  }

  /** Declare the conversation view slot the contribution registers into. */
  const declare = (slots: SlotRegistry): (() => void) =>
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    } as never, () => null)

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the info contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.sessionInfo', 'remote.openrouterSpend'])
  })

  it('registers the localized entry and dispatches settled reads to the store', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('conversation.view')).toHaveLength(1) })

    const entry = b.slots.entries('conversation.view')[0]!
    expect(entry.component).toBe(InfoView)
    expect(entry.options).toMatchObject({ id: 'info', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe(en['view.info'])
    expect(b.readInfo).not.toHaveBeenCalled()

    const store = createInfoStore().create()
    const injected = (entry.inject as unknown as InjectFactory)(SID, store.actions)

    b.readInfo.mockResolvedValueOnce({ ok: true, value: { ok: true, value: INFO } })
    b.readSpend.mockResolvedValueOnce({ ok: true, value: { ok: true, value: SPEND } })
    injected.loadInfo()
    injected.loadSpend()
    await vi.waitFor(() => { expect(store.getSnapshot()).toEqual({ info: { status: 'ready', snapshot: INFO }, spend: { status: 'ready', snapshot: SPEND } }) })
    expect(b.readInfo).toHaveBeenCalledWith({ sessionId: SID }, expect.any(AbortSignal))
    expect(b.readSpend).toHaveBeenCalledWith({ sessionId: SID }, expect.any(AbortSignal))

    const failure: SessionInfoFailure = { reason: 'session-unavailable', detail: 'gone' }
    b.readInfo.mockResolvedValueOnce({ ok: true, value: { ok: false, error: failure } })
    injected.loadInfo()
    await vi.waitFor(() => { expect(store.getSnapshot().info).toEqual({ status: 'failed', failure }) })

    b.readInfo.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'connection refused', {}) })
    injected.loadInfo()
    await vi.waitFor(() => {
      expect(store.getSnapshot().info).toEqual({ status: 'failed', failure: { reason: 'session-unavailable', detail: 'connection refused' } })
    })

    b.readSpend.mockRejectedValueOnce(new Error('boom'))
    injected.loadSpend()
    await vi.waitFor(() => {
      expect(store.getSnapshot().spend).toEqual({ status: 'failed', failure: { reason: 'unreachable', detail: 'Error: boom' } })
    })

    const spendFailure: OpenRouterSpendFailure = { reason: 'unauthorized', detail: '401' }
    b.readSpend.mockResolvedValueOnce({ ok: true, value: { ok: false, error: spendFailure } })
    injected.loadSpend()
    await vi.waitFor(() => { expect(store.getSnapshot().spend).toEqual({ status: 'failed', failure: spendFailure }) })

    await fiber.dispose()
  })

  it('lets a newer read abort the previous in-flight read', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('conversation.view')).toHaveLength(1) })

    const entry = b.slots.entries('conversation.view')[0]!
    const store = createInfoStore().create()
    const injected = (entry.inject as unknown as InjectFactory)(SID, store.actions)

    let settleFirst: ((value: unknown) => void) | undefined
    b.readInfo.mockReturnValueOnce(new Promise((resolve) => { settleFirst = resolve }))
    b.readInfo.mockResolvedValueOnce({ ok: true, value: { ok: true, value: INFO } })
    injected.loadInfo()
    injected.loadInfo()
    settleFirst?.({ ok: true, value: { ok: true, value: INFO } })
    await vi.waitFor(() => { expect(store.getSnapshot().info).toEqual({ status: 'ready', snapshot: INFO }) })
    expect(b.readInfo).toHaveBeenCalledTimes(2)

    let rejectFirst: ((error: unknown) => void) | undefined
    b.readSpend.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject }))
    b.readSpend.mockResolvedValueOnce({ ok: true, value: { ok: true, value: SPEND } })
    injected.loadSpend()
    injected.loadSpend()
    rejectFirst?.(new Error('late'))
    await vi.waitFor(() => { expect(store.getSnapshot().spend).toEqual({ status: 'ready', snapshot: SPEND }) })
    expect(b.readSpend).toHaveBeenCalledTimes(2)

    await fiber.dispose()
  })
})
