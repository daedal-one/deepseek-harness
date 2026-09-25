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
import { apply as hostApply } from '../src/index.ts'
import { apply, inject, NS } from '../src/client/index.ts'
import { SpendView, type SpendViewProps } from '../src/client/SpendView.tsx'
import { createSpendStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

usePinnedBrowserLanguages('en-US')

const t = makeTranslate(en)
const SID = 'spend-session' as SessionId
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

const SNAPSHOT: OpenRouterSpendSnapshot = {
  key: KEY,
  session: { provider: 'openrouter', model: 'vendor/model-x', costUsd: 0.03 },
  fetchedAt: EPOCH,
}

type SpendStoreInstance = ReturnType<ReturnType<typeof createSpendStore>['create']>
type InjectFactory = (sessionId: SessionId, actions: SpendStoreInstance['actions']) => { load: () => void }

/** Feed the view its composed seats directly; the renderer is not involved. */
function viewProps(store: SpendStoreInstance, load: () => void): SpendViewProps {
  return { load, useStore: bindSnapshotSelector(store), t } as unknown as SpendViewProps
}

afterEach(cleanup)

describe('SpendView', () => {
  it('shows the loading state and reads once on mount', () => {
    const store = createSpendStore().create()
    const load = vi.fn()
    const view = render(<SpendView {...viewProps(store, load)} />)
    expect(screen.getByText(en['state.loading'])).toBeTruthy()
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: en['action.refresh'] })).toBeTruthy()
    expect(load).toHaveBeenCalledOnce()
  })

  it('renders the key spend rows, the limit, and the session estimate for a priced model', () => {
    const store = createSpendStore().create()
    store.actions.succeed(SNAPSHOT)
    const view = render(<SpendView {...viewProps(store, vi.fn())} />)

    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByText(en['heading.key'])).toBeTruthy()
    expect(screen.getByText(KEY.label)).toBeTruthy()
    expect(screen.queryByText(en['tag.freeTier'])).toBeNull()
    expect(screen.getByText(en['row.total'])).toBeTruthy()
    expect(screen.getByText('1.25 USD')).toBeTruthy()
    expect(screen.getByText(en['row.daily'])).toBeTruthy()
    expect(screen.getByText('0.375 USD')).toBeTruthy()
    expect(screen.getByText(en['row.weekly'])).toBeTruthy()
    expect(screen.getByText('2.75 USD')).toBeTruthy()
    expect(screen.getByText(en['row.monthly'])).toBeTruthy()
    expect(screen.getByText('3.125 USD')).toBeTruthy()
    expect(screen.getByText(en['row.limitConfigured'])).toBeTruthy()
    expect(screen.getByText('10.00 USD')).toBeTruthy()
    expect(screen.getByText(en['row.limitRemaining'])).toBeTruthy()
    expect(screen.getByText('0.625 USD')).toBeTruthy()

    expect(screen.getByText(en['heading.session'])).toBeTruthy()
    expect(screen.getByText('vendor/model-x')).toBeTruthy()
    expect(screen.getByText('openrouter')).toBeTruthy()
    expect(screen.getByText('0.03 USD')).toBeTruthy()
    expect(screen.getByText(/Read at /)).toBeTruthy()
  })

  it('marks a free-tier key and renders both limit rows as unlimited when no limit is configured', () => {
    const store = createSpendStore().create()
    store.actions.succeed({
      ...SNAPSHOT,
      key: { ...KEY, label: 'sk-or-free', isFreeTier: true, limitUsd: null, limitRemainingUsd: null },
    })
    render(<SpendView {...viewProps(store, vi.fn())} />)

    expect(screen.getByText('sk-or-free')).toBeTruthy()
    expect(screen.getByText(en['tag.freeTier'])).toBeTruthy()
    expect(screen.getByText(en['row.limitConfigured'])).toBeTruthy()
    expect(screen.getByText(en['row.limitRemaining'])).toBeTruthy()
    expect(screen.getAllByText(en['money.none'])).toHaveLength(2)
  })

  it('keeps the remaining limit unlimited when the configured limit is absent', () => {
    const store = createSpendStore().create()
    store.actions.succeed({
      ...SNAPSHOT,
      key: { ...KEY, limitUsd: null, limitRemainingUsd: 0.625 },
    })
    render(<SpendView {...viewProps(store, vi.fn())} />)

    expect(screen.getAllByText(en['money.none'])).toHaveLength(2)
    expect(screen.queryByText('0.625 USD')).toBeNull()
  })

  it('renders only the session heading when the reading carries no session', () => {
    const store = createSpendStore().create()
    store.actions.succeed({ ...SNAPSHOT, session: null })
    const view = render(<SpendView {...viewProps(store, vi.fn())} />)

    expect(screen.getByText(en['heading.session'])).toBeTruthy()
    expect(view.container.querySelector('code')).toBeNull()
    expect(screen.queryByText('0.03 USD')).toBeNull()
  })

  it('shows the unpriceable wording and never a fabricated zero for an unpriced model', () => {
    const store = createSpendStore().create()
    store.actions.succeed({ ...SNAPSHOT, session: { ...SNAPSHOT.session, costUsd: null } })
    const view = render(<SpendView {...viewProps(store, vi.fn())} />)

    expect(screen.getByText(en['session.unpriceable'])).toBeTruthy()
    expect(view.queryByText('$0')).toBeNull()
    expect(view.queryByText('0 USD')).toBeNull()
    expect(view.queryByText('0.00 USD')).toBeNull()
  })

  it('re-reads when the refresh button is clicked', () => {
    const store = createSpendStore().create()
    const load = vi.fn()
    render(<SpendView {...viewProps(store, load)} />)
    fireEvent.click(screen.getByRole('button', { name: en['action.refresh'] }))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['not-configured', 'failure.not-configured'],
    ['unauthorized', 'failure.unauthorized'],
    ['rate-limited', 'failure.rate-limited'],
    ['unreachable', 'failure.unreachable'],
    ['malformed-response', 'failure.malformed-response'],
  ] as const)('renders distinct wording for a %s failure', (reason, key) => {
    const copies = [
      en['failure.not-configured'], en['failure.unauthorized'], en['failure.rate-limited'],
      en['failure.unreachable'], en['failure.malformed-response'],
    ]
    expect(new Set(copies).size).toBe(5)

    const store = createSpendStore().create()
    store.actions.fail({ reason, detail: 'host detail' })
    const view = render(<SpendView {...viewProps(store, vi.fn())} />)

    expect(screen.getByRole('alert').textContent).toBe(en[key])
    expect(screen.queryByText('host detail')).toBeNull()
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('false')
  })

  it('matches the keyless expected output for limits, priced and unpriceable sessions, and failure', async () => {
    const priced = createSpendStore().create()
    priced.actions.succeed(SNAPSHOT)
    const pricedView = render(<SpendView {...viewProps(priced, vi.fn())} />)
    const configuredLimit = pricedView.getByText(en['row.limitConfigured']).nextElementSibling?.textContent
    const remainingLimit = pricedView.getByText(en['row.limitRemaining']).nextElementSibling?.textContent
    const sessionPrice = pricedView.getByText('0.03 USD').textContent
    pricedView.unmount()

    const unpriceable = createSpendStore().create()
    unpriceable.actions.succeed({
      ...SNAPSHOT,
      key: { ...KEY, limitUsd: null, limitRemainingUsd: null },
      session: { ...SNAPSHOT.session!, costUsd: null },
    })
    const unpriceableView = render(<SpendView {...viewProps(unpriceable, vi.fn())} />)
    const unlimited = unpriceableView.getAllByText(en['money.none'])
    const unpriceableText = unpriceableView.getByText(en['session.unpriceable']).textContent
    unpriceableView.unmount()

    const failed = createSpendStore().create()
    failed.actions.fail({ reason: 'unauthorized', detail: 'fixture unauthorized' })
    const failedView = render(<SpendView {...viewProps(failed, vi.fn())} />)
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
    await expect(output).toBe(await readFile(resolve(process.cwd(), 'packages/client/ui-openrouter-spend/tests/spend-view.expected.md'), 'utf8'))
  })
})

describe('spend plugin wiring', () => {
  const bench = async () => {
    const ctx = new Context()
    const slotsFiber = ctx.plugin(SlotRegistry)
    await slotsFiber.await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const read = vi.fn()
    new TestRemote(ctx, { openrouterSpend: { read } })
    return { ctx, slots: ctx.get('slots') as SlotRegistry, read }
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

  it('declares only the services used by the spend contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.openrouterSpend'])
  })

  it('registers the localized entry and dispatches settled reads to the store', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('conversation.view')).toHaveLength(1) })

    const entry = b.slots.entries('conversation.view')[0]!
    expect(entry.component).toBe(SpendView)
    expect(entry.options).toMatchObject({ id: 'spend', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe(en['view.spend'])
    expect(b.read).not.toHaveBeenCalled()

    const store = createSpendStore().create()
    const injected = (entry.inject as unknown as InjectFactory)(SID, store.actions)

    b.read.mockResolvedValueOnce({ ok: true, value: { ok: true, value: SNAPSHOT } })
    injected.load()
    await vi.waitFor(() => { expect(store.getSnapshot()).toEqual({ status: 'ready', snapshot: SNAPSHOT }) })
    expect(b.read).toHaveBeenCalledTimes(1)
    expect(b.read).toHaveBeenCalledWith({ sessionId: SID }, expect.any(AbortSignal))

    const failure: OpenRouterSpendFailure = { reason: 'unauthorized', detail: '401' }
    b.read.mockResolvedValueOnce({ ok: true, value: { ok: false, error: failure } })
    injected.load()
    await vi.waitFor(() => { expect(store.getSnapshot()).toEqual({ status: 'failed', failure }) })

    b.read.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'connection refused', {}) })
    injected.load()
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toEqual({ status: 'failed', failure: { reason: 'unreachable', detail: 'connection refused' } })
    })

    b.read.mockRejectedValueOnce(new Error('boom'))
    injected.load()
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toEqual({ status: 'failed', failure: { reason: 'unreachable', detail: 'Error: boom' } })
    })

    await fiber.dispose()
  })

  it('lets a newer read abort the previous in-flight read', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('conversation.view')).toHaveLength(1) })

    const entry = b.slots.entries('conversation.view')[0]!
    const store = createSpendStore().create()
    const injected = (entry.inject as unknown as InjectFactory)(SID, store.actions)

    let settleFirst: ((value: unknown) => void) | undefined
    b.read.mockReturnValueOnce(new Promise(resolve => { settleFirst = resolve }))
    injected.load()
    b.read.mockResolvedValueOnce({ ok: true, value: { ok: true, value: SNAPSHOT } })
    injected.load()
    settleFirst?.({ ok: true, value: { ok: true, value: SNAPSHOT } })
    await vi.waitFor(() => { expect(store.getSnapshot()).toEqual({ status: 'ready', snapshot: SNAPSHOT }) })
    expect(b.read).toHaveBeenCalledTimes(2)

    let rejectFirst: ((error: unknown) => void) | undefined
    b.read.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject }))
    injected.load()
    b.read.mockResolvedValueOnce({ ok: true, value: { ok: true, value: SNAPSHOT } })
    injected.load()
    rejectFirst?.(new Error('late'))
    await vi.waitFor(() => { expect(store.getSnapshot()).toEqual({ status: 'ready', snapshot: SNAPSHOT }) })
    expect(b.read).toHaveBeenCalledTimes(4)

    await fiber.dispose()
  })
})
