// @vitest-environment jsdom
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
import type { SessionInfoFailure, SessionPromptSnapshot, SessionPromptTool } from '@deepseek-ai/dsh-session-info/types'
import { apply, inject, NS } from '../src/client/index.ts'
import { PromptView, type PromptViewProps } from '../src/client/PromptView.tsx'
import { createPromptStore } from '../src/client/prompt-store.ts'
import { en } from '../src/client/locales.ts'

usePinnedBrowserLanguages('en-US')

const t = makeTranslate(en)
const SID = 'prompt-session' as SessionId
const EPOCH = 1_758_360_000_000

const TOOLS: readonly SessionPromptTool[] = [
  {
    name: 'bash',
    description: 'Run a shell command.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line.' },
        timeoutMs: { type: 'number' },
      },
      required: ['command'],
    },
  },
  { name: 'read', description: 'Read one file.', parameters: { type: 'object', properties: {} } },
]

const PROMPT: SessionPromptSnapshot = {
  systemPrompt: 'You are an agent.\nObey the rules.',
  tools: TOOLS,
  model: { provider: 'openrouter', model: 'vendor/model-x' },
  readAt: EPOCH,
}

const EMPTY: SessionPromptSnapshot = { systemPrompt: '', tools: [], model: null, readAt: EPOCH }

type PromptStoreInstance = ReturnType<ReturnType<typeof createPromptStore>['create']>
type InjectFactory = (sessionId: SessionId, actions: PromptStoreInstance['actions']) => { loadPrompt: () => void }

/** Feed the view its composed seats directly; the renderer is not involved. */
function viewProps(store: PromptStoreInstance, loadPrompt: () => void): PromptViewProps {
  return { loadPrompt, useStore: bindSnapshotSelector(store), t } as unknown as PromptViewProps
}

/** Mark the reading settled so the view renders its body. */
function settled(snapshot: SessionPromptSnapshot = PROMPT): PromptStoreInstance {
  const store = createPromptStore().create()
  store.actions.succeed(snapshot)
  return store
}

/** Type one query into the search box. */
function search(query: string): void {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
}

afterEach(cleanup)

describe('PromptView', () => {
  it('shows the loading state and reads once on mount', () => {
    const store = createPromptStore().create()
    const loadPrompt = vi.fn()
    const view = render(<PromptView {...viewProps(store, loadPrompt)} />)

    expect(screen.getByText(en['prompt.loading'])).toBeTruthy()
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: en['action.refresh'] })).toBeTruthy()
    expect(loadPrompt).toHaveBeenCalledOnce()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('renders the system prompt, its figures, and the model route', () => {
    render(<PromptView {...viewProps(settled(), vi.fn())} />)

    expect(screen.getByRole('heading', { level: 2, name: en['heading.systemPrompt'] })).toBeTruthy()
    expect(screen.getByText(/You are an agent\./)).toBeTruthy()
    expect(screen.getByText(en['prompt.stats'].replace('{lines}', '2').replace('{characters}', '33'))).toBeTruthy()
    expect(screen.getByText(en['prompt.model'].replace('{provider}', 'openrouter').replace('{model}', 'vendor/model-x'))).toBeTruthy()
    expect(screen.getByText(/Prompt read at /)).toBeTruthy()
  })

  it('renders every tool with its description, parameter rows, and raw schema', () => {
    render(<PromptView {...viewProps(settled(), vi.fn())} />)

    expect(screen.getByRole('heading', { level: 2, name: en['heading.tools'] })).toBeTruthy()
    expect(screen.getByText(en['tools.count'].replace('{count}', '2'))).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('Run a shell command.')).toBeTruthy()
    expect(screen.getByText(en['tool.parameters'].replace('{count}', '2'))).toBeTruthy()
    expect(screen.getByText('Command line.')).toBeTruthy()
    expect(screen.getByText(en['parameter.required'])).toBeTruthy()
    expect(screen.getAllByText(en['value.none']).length).toBeGreaterThan(0)
    expect(screen.getAllByText(en['tool.schemaHeading']).length).toBe(2)
    expect(screen.getAllByText(/"type": "object"/)).toHaveLength(2)

    expect(screen.getByText('read')).toBeTruthy()
    expect(screen.getByText('Read one file.')).toBeTruthy()
    expect(screen.getByText(en['tool.noParameters'])).toBeTruthy()
  })

  it('states the explicit absence of a prompt and a tool catalog', () => {
    render(<PromptView {...viewProps(settled(EMPTY), vi.fn())} />)

    expect(screen.getByText(en['prompt.none'])).toBeTruthy()
    expect(screen.getByText(en['tools.none'])).toBeTruthy()
    expect(screen.queryByText(en['prompt.model'].replace('{provider}', 'openrouter').replace('{model}', 'vendor/model-x'))).toBeNull()
  })

  it('filters the catalog and reports the prompt matches for the query', () => {
    render(<PromptView {...viewProps(settled(), vi.fn())} />)

    expect(screen.getByText(en['search.count'].replace('{shown}', '2').replace('{total}', '2'))).toBeTruthy()

    search('read one')
    expect(screen.getByText('read')).toBeTruthy()
    expect(screen.queryByText('bash')).toBeNull()
    expect(screen.getByText(en['search.count'].replace('{shown}', '1').replace('{total}', '2'))).toBeTruthy()
    expect(screen.getByText(en['prompt.matches'].replace('{count}', '0'))).toBeTruthy()

    search('agent')
    expect(screen.getByText(en['prompt.matches'].replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText(en['tools.noMatches'])).toBeTruthy()
    expect(screen.getByText(en['tools.count'].replace('{count}', '2'))).toBeTruthy()
  })

  it('renders a tool whose schema declares no parameter type with the untyped wording', () => {
    render(<PromptView {...viewProps(settled({
      ...PROMPT,
      tools: [{ name: 'opaque', description: 'Opaque tool.', parameters: { properties: { value: {} } } }],
    }), vi.fn())} />)

    expect(screen.getByText(en['parameter.noType'])).toBeTruthy()
  })

  it('renders the failure state and never the Host detail', () => {
    const store = createPromptStore().create()
    store.actions.fail({ reason: 'session-unavailable', detail: 'host detail' })
    const view = render(<PromptView {...viewProps(store, vi.fn())} />)

    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('alert').textContent).toBe(en['failure.session-unavailable'])
    expect(view.queryByText('host detail')).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('re-reads the prompt when the refresh button is clicked', () => {
    const loadPrompt = vi.fn()
    render(<PromptView {...viewProps(settled(), loadPrompt)} />)
    fireEvent.click(screen.getByRole('button', { name: en['action.refresh'] }))
    expect(loadPrompt).toHaveBeenCalledTimes(2)
  })
})

describe('prompt view plugin wiring', () => {
  const bench = async () => {
    const ctx = new Context()
    const slotsFiber = ctx.plugin(SlotRegistry)
    await slotsFiber.await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const readInfo = vi.fn()
    const readPrompt = vi.fn()
    const readSpend = vi.fn()
    new TestRemote(ctx, {
      sessionInfo: { read: readInfo, readPrompt },
      openrouterSpend: { read: readSpend },
    })
    return { ctx, slots: ctx.get('slots') as SlotRegistry, readPrompt }
  }

  /** Declare the conversation view slot the contributions register into. */
  const declare = (slots: SlotRegistry): (() => void) =>
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    } as never, () => null)

  it('registers the localized Prompt entry beside the Info entry', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('conversation.view')).toHaveLength(2) })

    const entries = b.slots.entries('conversation.view')
    const info = entries[0]!
    const prompt = entries[1]!
    expect(info.component).not.toBe(PromptView)
    expect(info.options).toMatchObject({ id: 'info', order: 20 })
    expect(prompt.component).toBe(PromptView)
    expect(prompt.options).toMatchObject({ id: 'prompt', order: 30 })
    expect(prompt.locale).toBe(NS)
    expect(resolveSlotLabel(prompt.options.label)).toBe(en['view.prompt'])
    expect(b.readPrompt).not.toHaveBeenCalled()

    await fiber.dispose()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
  })

  it('dispatches settled reads, Host failures, and carrier failures to the store', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('conversation.view')).toHaveLength(2) })

    const entry = b.slots.entries('conversation.view')[1]!
    const store = createPromptStore().create()
    const injected = (entry.inject as unknown as InjectFactory)(SID, store.actions)

    b.readPrompt.mockResolvedValueOnce({ ok: true, value: { ok: true, value: PROMPT } })
    injected.loadPrompt()
    await vi.waitFor(() => { expect(store.getSnapshot().prompt).toEqual({ status: 'ready', snapshot: PROMPT }) })
    expect(b.readPrompt).toHaveBeenCalledWith({ sessionId: SID }, expect.any(AbortSignal))

    const failure: SessionInfoFailure = { reason: 'session-unavailable', detail: 'gone' }
    b.readPrompt.mockResolvedValueOnce({ ok: true, value: { ok: false, error: failure } })
    injected.loadPrompt()
    await vi.waitFor(() => { expect(store.getSnapshot().prompt).toEqual({ status: 'failed', failure }) })

    b.readPrompt.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'connection refused', {}) })
    injected.loadPrompt()
    await vi.waitFor(() => {
      expect(store.getSnapshot().prompt).toEqual({
        status: 'failed',
        failure: { reason: 'session-unavailable', detail: 'connection refused' },
      })
    })

    b.readPrompt.mockRejectedValueOnce(new Error('boom'))
    injected.loadPrompt()
    await vi.waitFor(() => {
      expect(store.getSnapshot().prompt).toEqual({
        status: 'failed',
        failure: { reason: 'session-unavailable', detail: 'Error: boom' },
      })
    })

    await fiber.dispose()
  })

  it('lets a newer read abort the previous in-flight read', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('conversation.view')).toHaveLength(2) })

    const entry = b.slots.entries('conversation.view')[1]!
    const store = createPromptStore().create()
    const injected = (entry.inject as unknown as InjectFactory)(SID, store.actions)

    let settleFirst: ((value: unknown) => void) | undefined
    b.readPrompt.mockReturnValueOnce(new Promise((resolve) => { settleFirst = resolve }))
    b.readPrompt.mockResolvedValueOnce({ ok: true, value: { ok: true, value: PROMPT } })
    injected.loadPrompt()
    injected.loadPrompt()
    settleFirst?.({ ok: true, value: { ok: false, error: { reason: 'session-unavailable', detail: 'late' } } })
    await vi.waitFor(() => { expect(store.getSnapshot().prompt).toEqual({ status: 'ready', snapshot: PROMPT }) })
    expect(b.readPrompt).toHaveBeenCalledTimes(2)

    let rejectFirst: ((error: unknown) => void) | undefined
    b.readPrompt.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject }))
    b.readPrompt.mockResolvedValueOnce({ ok: true, value: { ok: true, value: PROMPT } })
    injected.loadPrompt()
    injected.loadPrompt()
    rejectFirst?.(new Error('late'))
    await vi.waitFor(() => { expect(store.getSnapshot().prompt).toEqual({ status: 'ready', snapshot: PROMPT }) })
    expect(b.readPrompt).toHaveBeenCalledTimes(4)

    await fiber.dispose()
  })
})
