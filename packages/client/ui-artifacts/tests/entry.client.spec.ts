// @vitest-environment jsdom
/** Workspace menu ownership and trusted shell operation authority. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ResourceRegistry } from '../../resources/src/client/resources.ts'
import { apply } from '../src/client/index.ts'
import { apply as applyHost } from '../src/index.ts'
import type { ArtifactInjected } from '../src/client/Body.tsx'
import type { ArtifactRevision } from '@deepseek-ai/dsh-artifact/types'
import { en } from '../src/client/locales.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})
const revision = {
  workspaceId: 'workspace',
  artifactId: 'artifact',
  revisionId: 'revision',
  entry: 'index.html',
} as ArtifactRevision
function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  let action: { id: string; label: () => string; run: (id: never) => void } | undefined
  let view: ArtifactInjected | undefined
  const unregisterMenu = vi.fn(),
    unregisterPanel = vi.fn(),
    unregisterLocale = vi.fn()
  const layout = { closeRightbar: vi.fn(), openRightbar: vi.fn(), selectPanel: vi.fn() }
  const uiWorkspace = {
    connectWorkspace: vi.fn(async () => 'editor'),
    openSession: vi.fn(),
    registerWorkspaceMenu: vi.fn((value: { id: string; label: () => string; run: (id: never) => void }) => {
      action = value
      return unregisterMenu
    }),
  }
  const prompt = vi.fn(async () => ({ ok: true, value: undefined }))
  const binding = vi.fn(() => ({ session: { prompt } }))
  const ok = <T>(value: T) => ({ ok: true as const, value })
  const caps = { maxRetainedBytes: 10000, maxSelectionBytes: 2048 }
  const remote = {
    list: vi.fn(async () => ok({ items: [], next: null })),
    history: vi.fn(async () => ok([revision])),
    pending: vi.fn(async () => ok([])),
    reconcile: vi.fn(async () => ok(revision)),
    policy: vi.fn(async () => ok(caps)),
    edit: vi.fn(async () => ok(revision)),
    restore: vi.fn(async () => ok(revision)),
    read: vi.fn(async () => ok({ revision, asset: { file: { bytes: 1 } }, data: btoa('x') })),
    interact: vi.fn(async () => ok({ text: 'frame' })),
    watch: vi.fn(async function* (_id: unknown, _signal: AbortSignal) {
      yield true
    }),
    preview: vi.fn(async function* () {
      yield { text: 'frame' }
    }),
  }
  ctx.provide('remote', { artifacts: remote } as never)
  ctx.provide('resources', new ResourceRegistry(ctx))
  ctx.provide('locale', { bind: () => makeTranslate(en), register: () => unregisterLocale } as never)
  ctx.provide('uiWorkspace', uiWorkspace as never)
  ctx.provide('layout', layout as never)
  ctx.provide('sessions', { binding } as never)
  ctx.provide('slots', {
    register: (options: { inject: () => ArtifactInjected }) => {
      view = options.inject()
      return unregisterPanel
    },
  } as never)
  applyHost()
  apply(ctx)
  return {
    ctx,
    action: () => action!,
    view: () => view!,
    remote,
    uiWorkspace,
    layout,
    prompt,
    binding,
    caps,
    unregisterMenu,
    unregisterPanel,
    unregisterLocale,
  }
}
it('owns a localized menu and exact Workspace panel through replacement and plugin disposal', async () => {
  const h = harness()
  expect(h.action().id).toBe('artifacts')
  expect(h.action().label()).toBe('Artifacts')
  h.action().run('workspace' as never)
  const first = h.view()
  const changed = vi.fn()
  await first.watch(new AbortController().signal, changed)
  expect(changed).toHaveBeenCalledOnce()
  expect(h.remote.watch.mock.calls[0]![0]).toBe('workspace')
  await first.list(null)
  await first.history(revision.artifactId, null)
  await first.pending()
  await first.reconcile(revision.revisionId)
  await first.policy()
  expect(h.uiWorkspace.connectWorkspace).not.toHaveBeenCalled()
  expect(await first.read(revision, revision.entry)).toMatchObject({ data: btoa('x') })
  expect(h.remote.read.mock.calls[0]!.slice(0, 4)).toEqual([
    'workspace',
    'artifact',
    'revision',
    'index.html',
  ])
  await first.read(revision, revision.entry, new AbortController().signal)
  first.presentation(false)
  expect(h.layout.openRightbar).toHaveBeenLastCalledWith(false, true)
  h.action().run('workspace' as never)
  expect(h.view()).toBe(first)
  expect(h.unregisterPanel).not.toHaveBeenCalled()
  h.action().run('other' as never)
  expect(h.view().workspaceId).toBe('other')
  expect(h.unregisterPanel).toHaveBeenCalledOnce()
  expect(h.remote.watch.mock.calls[0]![1].aborted).toBe(true)
  await expect(first.save(revision, revision.entry, 'x', first.newOperationId())).rejects.toThrow()
  await h.ctx.fiber.dispose()
  expect(h.unregisterMenu).toHaveBeenCalledOnce()
  expect(h.unregisterLocale).toHaveBeenCalledOnce()
  expect(h.unregisterPanel).toHaveBeenCalledTimes(2)
})
it('uses only a connected editing Session for explicit trusted edit, restore and selection requests', async () => {
  const h = harness()
  h.action().run('workspace' as never)
  const view = h.view(),
    operation = view.newOperationId(),
    signal = new AbortController().signal
  expect(operation).toMatch(/^[a-f0-9-]{36}$/u)
  await view.save(revision, 'index.html', 'Updated', operation)
  expect(h.remote.edit).toHaveBeenCalledWith(
    'editor',
    'workspace',
    'artifact',
    'revision',
    'index.html',
    'Updated',
    operation,
  )
  await view.restore(revision, revision.revisionId, operation)
  expect(h.remote.restore).toHaveBeenCalledWith('editor', 'artifact', 'revision', 'revision', operation)
  const received = vi.fn()
  await view.preview(revision, signal, received)
  expect(received).toHaveBeenCalledWith({ text: 'frame' })
  await view.interact(revision, { invocationId: 'invocation' } as never, { type: 'key', key: 'Tab' })
  expect(h.remote.interact.mock.calls[0]!.slice(0, 4)).toEqual([
    'workspace',
    'artifact',
    'revision',
    'invocation',
  ])
  await view.ask(revision, 'index.html', '<h1>untrusted</h1>', 'change title', signal)
  const text = (h.prompt.mock.calls[0] as unknown as [Array<{ text: string }>])[0][0]!.text
  expect(text).toContain('untrusted data')
  expect(JSON.parse(text.slice(text.indexOf('\n') + 1))).toMatchObject({
    workspaceId: 'workspace',
    revisionId: 'revision',
    selection: '<h1>untrusted</h1>',
  })
  expect(h.uiWorkspace.openSession).toHaveBeenCalledWith('editor')
})
it('propagates authenticated failures and refuses oversized or unavailable editing requests', async () => {
  const h = harness()
  h.action().run('workspace' as never)
  const view = h.view(),
    signal = new AbortController().signal
  h.remote.list.mockRejectedValueOnce(new Error('offline'))
  await expect(view.list(null)).rejects.toThrow('offline')
  h.remote.policy.mockResolvedValueOnce({ ok: false, error: { message: 'denied' } } as never)
  await expect(view.policy()).rejects.toThrow('denied')
  h.caps.maxSelectionBytes = 1
  await expect(view.ask(revision, revision.entry, 'text', 'edit', signal)).rejects.toThrow(en.requestTooLarge)
  expect(h.prompt).not.toHaveBeenCalled()
  h.caps.maxSelectionBytes = 2048
  h.binding.mockReturnValueOnce(undefined as never)
  await expect(view.ask(revision, revision.entry, 'text', 'edit', signal)).rejects.toThrow(en.editUnavailable)
  const aborted = new AbortController()
  aborted.abort(new Error('cancelled'))
  await expect(view.ask(revision, revision.entry, 'text', 'edit', aborted.signal)).rejects.toThrow(
    'cancelled',
  )
  expect(h.prompt).not.toHaveBeenCalled()
})
