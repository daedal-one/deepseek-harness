// @vitest-environment jsdom
/** Trusted artifact source, revision, edit, and preview lifecycle behavior. */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ArtifactBody } from '../src/client/Body.tsx'
import type { ArtifactBodyProps } from '../src/client/Body.tsx'
import { en } from '../src/client/locales.ts'
import type { ArtifactFrame } from '@deepseek-ai/dsh-artifact-runtime/types'
import type {
  ArtifactContent,
  ArtifactRevision,
  ArtifactId,
  ArtifactRevisionId,
} from '@deepseek-ai/dsh-artifact/types'
afterEach(cleanup)
const revision = {
  artifactId: 'artifact',
  revisionId: 'revision',
  workspaceId: 'workspace',
  sessionId: 'publisher',
  operationId: 'operation',
  parent: null,
  restoredFrom: null,
  title: 'Report',
  entry: 'index.html',
  profile: 'interactive-local',
  capabilities: ['published-assets', 'transient-input'],
  createdAt: '2026-10-04T00:00:00.000Z',
  assets: [
    {
      name: 'index.html',
      mediaType: 'text/html',
      sha256: 'digest',
      file: { attachmentId: 'blob', name: 'index.html', bytes: 32 },
    },
  ],
} as unknown as ArtifactRevision
const original = '<script>window.STOLEN=true</script><h1>Report</h1>'
const content = { revision, asset: revision.assets[0]!, data: btoa(original) } satisfies ArtifactContent
function mount(patch: Partial<ArtifactBodyProps> = {}) {
  const props = {
    workspaceId: revision.workspaceId,
    width: 420,
    viewportWidth: 1440,
    canShow: true,
    useWorkspaces: (select: (state: unknown) => unknown) =>
      select({ items: [{ workspaceId: revision.workspaceId, title: 'Workspace' }] }),
    close: vi.fn(),
    presentation: vi.fn(),
    watch: vi.fn(async (signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else
          signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
      })
    }),
    list: vi.fn(async () => ({ items: [{ head: revision, revisionCount: 1 }], next: null })),
    history: vi.fn(async () => [revision]),
    read: vi.fn(async () => content),
    pending: vi.fn(async () => []),
    reconcile: vi.fn(async () => revision),
    policy: vi.fn(async () => ({
      previewAvailable: false,
      maxRetainedBytes: 33554432,
      maxEditBytes: 4096,
      maxSelectionBytes: 4096,
    })),
    save: vi.fn(async () => ({ ...revision, revisionId: 'new' })),
    restore: vi.fn(async () => revision),
    preview: vi.fn(async () => {}),
    interact: vi.fn(async () => ({})),
    ask: vi.fn(async () => {}),
    newOperationId: () => randomUUID(),
    t: makeTranslate(en),
    ...patch,
  } as unknown as ArtifactBodyProps
  const view = render(<ArtifactBody {...props} />)
  return { props, view }
}
async function openReport() {
  fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
  await screen.findByRole('textbox', { name: 'Source' })
}
describe('Workspace artifact trusted controls', () => {
  it('opens immutable source without executing authored content or invoking editing callbacks', async () => {
    const h = mount()
    await openReport()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }).value).toBe(original)
    expect(document.querySelector('script')).toBeNull()
    expect(h.props.save).not.toHaveBeenCalled()
    expect(h.props.ask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByText(en.unavailable)).not.toBeNull()
    expect(h.props.preview).not.toHaveBeenCalled()
  })
  it('keeps an immutable revision pinned when the catalogue head refreshes', async () => {
    const h = mount()
    await openReport()
    vi.mocked(h.props.list).mockResolvedValue({
      items: [{ head: { ...revision, revisionId: 'newer' as never }, revisionCount: 2 }],
      next: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(h.props.list).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }).value).toBe(original)
    expect(h.props.read).toHaveBeenCalledTimes(1)
  })
  it('retries the same exact edit identity and bytes after uncertain acknowledgement', async () => {
    const h = mount()
    vi.mocked(h.props.save)
      .mockRejectedValueOnce(new Error('uncertain'))
      .mockResolvedValueOnce({ ...revision, revisionId: 'new' as never })
    await openReport()
    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
    fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }), {
      target: { value: 'Updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }))
    await screen.findByText('Could not complete this action: uncertain')
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }))
    await waitFor(() => {
      expect(h.props.save).toHaveBeenCalledTimes(2)
    })
    expect(vi.mocked(h.props.save).mock.calls[0]).toEqual(vi.mocked(h.props.save).mock.calls[1])
  })
  it('revokes an independent preview on replacement and unmount', async () => {
    const signals: AbortSignal[] = []
    const h = mount({
      policy: vi.fn(async () => ({
        previewAvailable: true,
        maxRetainedBytes: 33554432,
        maxEditBytes: 4096,
        maxSelectionBytes: 4096,
      })),
      preview: vi.fn((_r: ArtifactRevision, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
        })
      }),
    })
    await openReport()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => {
      expect(signals).toHaveLength(1)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(signals[0]!.aborted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => {
      expect(signals).toHaveLength(2)
    })
    h.view.unmount()
    expect(signals[1]!.aborted).toBe(true)
  })
  it('refreshes after durable changes while preserving the selected source and retires its subscription', async () => {
    let changed: (() => void) | undefined
    const signals: AbortSignal[] = []
    const h = mount({
      watch: vi.fn(async (signal: AbortSignal, notify: () => void) => {
        changed = notify
        signals.push(signal)
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
        })
      }),
    })
    await openReport()
    const newer = { ...revision, revisionId: 'newer' as never }
    vi.mocked(h.props.list).mockResolvedValue({ items: [{ head: newer, revisionCount: 2 }], next: null })
    changed!()
    await screen.findByText(new RegExp(en.historical))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }).value).toBe(original)
    expect(h.props.read).toHaveBeenCalledTimes(1)
    h.view.unmount()
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })
  it('refuses oversized retained content without associating it with a different selection', async () => {
    const h = mount({
      policy: vi.fn(async () => ({
        previewAvailable: false,
        maxRetainedBytes: 10000,
        maxEditBytes: 4096,
        maxSelectionBytes: 4096,
      })),
    })
    await openReport()
    const huge = {
      ...content,
      data: btoa('x'.repeat(10000)),
      asset: { ...content.asset, file: { ...content.asset.file, bytes: 10000 } },
    }
    vi.mocked(h.props.read).mockResolvedValueOnce(huge)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: revision.entry } })
    await screen.findByText(en.viewerTooLarge)
    expect(screen.queryByRole('textbox', { name: 'Source' })).toBeNull()
    expect(h.props.save).not.toHaveBeenCalled()
  })
  it('retires a stale source response when another immutable revision is selected', async () => {
    const held = Promise.withResolvers<ArtifactContent>()
    const h = mount({
      list: vi.fn(async () => ({
        items: [
          { head: revision, revisionCount: 1 },
          {
            head: {
              ...revision,
              artifactId: 'second' as never,
              revisionId: 'second-revision' as never,
              title: 'Second',
            },
            revisionCount: 1,
          },
        ],
        next: null,
      })),
    })
    vi.mocked(h.props.read)
      .mockImplementationOnce(() => held.promise)
      .mockImplementationOnce(async r => ({ ...content, revision: r, data: btoa('Second source') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    await waitFor(() => {
      expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }).value).toBe('Second source')
    })
    held.resolve(content)
    await held.promise
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }).value).toBe('Second source')
    expect(vi.mocked(h.props.read).mock.calls[0]![2]!.aborted).toBe(true)
  })
  it('exposes retry after an initial catalogue failure', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ items: [{ head: revision, revisionCount: 1 }], next: null })
    mount({ list })
    await screen.findByText('Could not complete this action: offline')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('button', { name: 'Report' })
  })
})

it('loads catalogue pages and historical content, compares bytes and restores a new head', async () => {
  const old = { ...revision, revisionId: 'old' as never, createdAt: '2026-10-03T00:00:00.000Z' }
  const h = mount({
    list: vi.fn(async (after: ArtifactId | null) =>
      after === null
        ? { items: [{ head: revision, revisionCount: 2 }], next: 'next' as never }
        : {
          items: [
            { head: { ...revision, artifactId: 'second' as never, title: 'Second' }, revisionCount: 1 },
          ],
          next: null,
        },
    ),
    history: vi.fn(async (_id: ArtifactId, before: ArtifactRevisionId | null) =>
      before === null ? [revision] : [revision, old],
    ),
    read: vi.fn(async (r: ArtifactRevision) => ({
      ...content,
      revision: r,
      data: btoa(r.revisionId === old.revisionId ? 'Earlier content' : original),
    })),
    restore: vi.fn(async () => ({
      ...revision,
      revisionId: 'restored' as never,
      restoredFrom: old.revisionId,
    })),
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
  await screen.findByRole('button', { name: 'Second' })
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'History' }))
  await screen.findByRole('button', { name: /2026-10-04.*revision/u })
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  const historical = await screen.findByRole('button', { name: /2026-10-03.*old/u })
  expect(screen.getAllByRole('button', { name: /2026-10-04.*revision/u })).toHaveLength(1)
  fireEvent.click(screen.getAllByRole('button', { name: 'Compare revisions' })[1]!)
  await waitFor(() => {
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Selected revision' }).value).toBe(
      'Earlier content',
    )
  })
  fireEvent.click(historical)
  await waitFor(() => {
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }).value).toBe('Earlier content')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Restore as a new revision' }))
  await waitFor(() => {
    expect(h.props.restore).toHaveBeenCalledOnce()
  })
  expect(vi.mocked(h.props.restore).mock.calls[0]!.slice(0, 2)).toEqual([old, revision.revisionId])
})
it('requires an explicit nonempty bounded selection and sends only the selected original source', async () => {
  const h = mount()
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'Ask an agent to edit' }))
  await screen.findByText('Could not complete this action: ' + en.selectionRequired)
  const source = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' })
  source.setSelectionRange(0, 8)
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe the change' }), {
    target: { value: 'Change this selection' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask an agent to edit' }))
  await screen.findByText(en.requestSent)
  expect(vi.mocked(h.props.ask).mock.calls[0]!.slice(0, 4)).toEqual([
    revision,
    'index.html',
    original.slice(0, 8),
    'Change this selection',
  ])
})
it('refuses oversized edits and selection requests while leaving prior content readable', async () => {
  mount({
    policy: vi.fn(async () => ({
      previewAvailable: false,
      maxRetainedBytes: 33554432,
      maxEditBytes: 100,
      maxSelectionBytes: 8,
    })),
  })
  await openReport()
  const source = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' })
  source.setSelectionRange(0, 8)
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe the change' }), {
    target: { value: 'Change title' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask an agent to edit' }))
  await screen.findByText('Could not complete this action: ' + en.requestTooLarge)
  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
  fireEvent.change(source, { target: { value: 'x'.repeat(101) } })
  fireEvent.click(screen.getByRole('button', { name: 'Save revision' }))
  await screen.findByText('Could not complete this action: ' + en.editTooLarge)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }))
  expect(source.value).toBe(original)
})
it('exposes exact original download and clipboard only on trusted gestures', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const create = vi.fn(() => 'blob:download'),
    revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  mount()
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'Download original' }))
  expect(create).toHaveBeenCalledOnce()
  expect((create.mock.calls as unknown as [[Blob]])[0][0].size).toBe(original.length)
  await waitFor(() => {
    expect(revoke).toHaveBeenCalledWith('blob:download')
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!)
  expect(writeText).toHaveBeenCalledWith(original)
  writeText.mockRejectedValueOnce(new Error('clipboard refused'))
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await screen.findByText('Could not complete this action: clipboard refused')
  click.mockRestore()
})
it('does not expose a text editor for binary or invalid UTF-8 content', async () => {
  const h = mount({
    read: vi.fn(async () => ({ ...content, asset: { ...content.asset, mediaType: 'image/png' } })),
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
  await screen.findByText(en.noText)
  expect(screen.queryByRole('textbox', { name: 'Source' })).toBeNull()
  vi.mocked(h.props.read).mockResolvedValueOnce({ ...content, data: btoa('\xff') })
  await waitFor(() => {
    expect(screen.getByRole('combobox')).not.toBeNull()
  })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'index.html' } })
  await waitFor(() => {
    expect(h.props.read).toHaveBeenCalledTimes(2)
  })
  expect(screen.queryByRole('button', { name: 'Edit text' })).toBeNull()
})
it('reconciles an interrupted save and refreshes its catalogue without activating a conversation', async () => {
  const h = mount({
    pending: vi
      .fn()
      .mockResolvedValueOnce([{ revisionId: 'pending', createdAt: 'yesterday' }])
      .mockResolvedValue([]),
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Recover save · yesterday' }))
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Recover save · yesterday' })).toBeNull()
  })
  expect(h.props.reconcile).toHaveBeenCalledWith('pending')
  expect(h.props.list).toHaveBeenCalledTimes(2)
})
it('translates bounded pointer and keyboard gestures and retires late interaction results', async () => {
  const frame = {
    invocationId: 'preview',
    revisionId: revision.revisionId,
    png: 'png',
    text: 'Ready',
    width: 640,
    height: 480,
  } as ArtifactFrame
  const pending = Promise.withResolvers<ArtifactFrame>()
  const h = mount({
    policy: vi.fn(async () => ({
      previewAvailable: true,
      maxRetainedBytes: 33554432,
      maxEditBytes: 4096,
      maxSelectionBytes: 4096,
    })),
    preview: vi.fn(
      async (_revision: ArtifactRevision, signal: AbortSignal, receive: (frame: ArtifactFrame) => void) => {
        receive(frame)
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
        })
      },
    ),
    interact: vi.fn(async () => frame),
  })
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  const image = await screen.findByRole<HTMLImageElement>('img', { name: en.accessibility })
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 320,
    height: 240,
  } as DOMRect)
  fireEvent.click(image, { clientX: 170, clientY: 140 })
  await waitFor(() => {
    expect(h.props.interact).toHaveBeenCalledOnce()
  })
  expect(vi.mocked(h.props.interact).mock.calls[0]![2]).toEqual({ type: 'pointer', x: 320, y: 240 })
  fireEvent.change(screen.getByRole('textbox', { name: en.assetInput }), { target: { value: 'local input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enter text' }))
  await waitFor(() => {
    expect(h.props.interact).toHaveBeenCalledTimes(2)
  })
  expect(vi.mocked(h.props.interact).mock.calls[1]![2]).toEqual({ type: 'text', text: 'local input' })
  fireEvent.click(screen.getByRole('button', { name: 'Tab' }))
  await waitFor(() => {
    expect(h.props.interact).toHaveBeenCalledTimes(3)
  })
  vi.mocked(h.props.interact).mockImplementationOnce(() => pending.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Enter' }))
  fireEvent.click(screen.getByRole('button', { name: 'Source' }))
  pending.resolve({ ...frame, text: 'Late output' })
  await pending.promise
  expect(screen.queryByText('Late output')).toBeNull()
})
it('keeps document previews inert and reports normal completion and runtime failures', async () => {
  const documentRevision = {
    ...revision,
    profile: 'document' as const,
    capabilities: ['published-assets'] as const,
  }
  const hold = Promise.withResolvers<undefined>()
  const h = mount({
    list: vi.fn(async () => ({ items: [{ head: documentRevision, revisionCount: 1 }], next: null })),
    read: vi.fn(async () => ({ ...content, revision: documentRevision })),
    policy: vi.fn(async () => ({
      previewAvailable: true,
      maxRetainedBytes: 33554432,
      maxEditBytes: 4096,
      maxSelectionBytes: 4096,
    })),
    preview: vi.fn(
      async (_revision: ArtifactRevision, _signal: AbortSignal, receive: (frame: ArtifactFrame) => void) => {
        receive({
          invocationId: 'preview',
          revisionId: revision.revisionId,
          png: '',
          text: 'Document',
          width: 640,
          height: 480,
        } as never)
        await hold.promise
      },
    ),
  })
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  fireEvent.click(await screen.findByRole('img'))
  expect(h.props.interact).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Enter text' })).toBeNull()
  hold.resolve(undefined)
  await screen.findByText('Could not complete this action: ' + en.ended)
  fireEvent.click(screen.getByRole('button', { name: 'Source' }))
  vi.mocked(h.props.preview).mockRejectedValueOnce('renderer failed')
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByText('Could not complete this action: renderer failed')
})
it('closes a revoked Workspace and does not adopt results after disposal', async () => {
  const h = mount({ useWorkspaces: select => select({ items: [] } as never), canShow: false })
  await waitFor(() => {
    expect(h.props.close).toHaveBeenCalled()
  })
  expect(h.props.presentation).toHaveBeenCalledWith(false)
  const read = Promise.withResolvers<ArtifactContent>()
  vi.mocked(h.props.read).mockImplementationOnce(() => read.promise)
  fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
  h.view.unmount()
  read.resolve(content)
  await read.promise
  expect(screen.queryByRole('textbox', { name: 'Source' })).toBeNull()
})

it('shows an empty Workspace catalogue and a repeatable refresh error', async () => {
  const list = vi.fn(async () => ({ items: [], next: null }))
  mount({ list })
  await screen.findByText(en.empty)
  list.mockRejectedValueOnce('refresh refused')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText('Could not complete this action: refresh refused')
})
it('reports failure reading the selected source and failure sending an explicit agent request', async () => {
  const h = mount()
  vi.mocked(h.props.read).mockRejectedValueOnce(new Error('blob unavailable'))
  fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
  await screen.findByText('Could not complete this action: blob unavailable')
  await openReport()
  const source = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' })
  source.setSelectionRange(0, 8)
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe the change' }), {
    target: { value: 'Edit title' },
  })
  vi.mocked(h.props.ask).mockRejectedValueOnce(new Error('agent unavailable'))
  fireEvent.click(screen.getByRole('button', { name: 'Ask an agent to edit' }))
  await screen.findByText('Could not complete this action: agent unavailable')
})
it('retires a catalogue initialization that resolves after the pane closes', async () => {
  const held = Promise.withResolvers<Awaited<ReturnType<ArtifactBodyProps['list']>>>()
  const h = mount({ list: vi.fn(() => held.promise) })
  h.view.unmount()
  held.resolve({ items: [{ head: revision, revisionCount: 1 }], next: null })
  await held.promise
  expect(screen.queryByRole('button', { name: 'Report' })).toBeNull()
})
it('coalesces catalogue invalidations while a refresh is pending and reports subscription failure', async () => {
  let notify: (() => void) | undefined
  const failure = Promise.withResolvers<undefined>()
  const h = mount({
    watch: vi.fn((_signal: AbortSignal, changed: () => void) => {
      notify = changed
      return failure.promise
    }),
  })
  await openReport()
  const held = Promise.withResolvers<Awaited<ReturnType<ArtifactBodyProps['list']>>>()
  vi.mocked(h.props.list).mockImplementationOnce(() => held.promise)
  notify!()
  notify!()
  held.resolve({ items: [], next: null })
  await waitFor(() => {
    expect(h.props.list).toHaveBeenCalledTimes(3)
  })
  failure.reject(new Error('watch disconnected'))
  await screen.findByText('Could not complete this action: watch disconnected')
})

const enabledPolicy = async () => ({
  previewAvailable: true,
  maxRetainedBytes: 33554432,
  maxEditBytes: 4096,
  maxSelectionBytes: 4096,
})
const liveFrame = {
  invocationId: 'preview',
  revisionId: revision.revisionId,
  png: 'png',
  text: 'Live',
  width: 640,
  height: 480,
} as ArtifactFrame
it('retires rejected source work after a newer selection is readable', async () => {
  const held = Promise.withResolvers<ArtifactContent>()
  const read = vi
    .fn()
    .mockImplementationOnce(() => held.promise)
    .mockResolvedValue(content)
  const h = mount({ read })
  fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
  await waitFor(() => {
    expect(read).toHaveBeenCalledOnce()
  })
  await openReport()
  await act(async () => {
    held.reject(new Error('old read'))
    await held.promise.catch(() => {})
  })
  expect(screen.queryByText(/old read/)).toBeNull()
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' }).value).toBe(original)
  expect(h.props.read).toHaveBeenCalledTimes(2)
})
it.each(['resolve', 'reject'] as const)(
  'retires a preview %s and frames delivered after replacement',
  async (outcome) => {
    const held = Promise.withResolvers<undefined>()
    let receive: ((value: ArtifactFrame) => void) | undefined
    const h = mount({
      policy: enabledPolicy,
      preview: vi.fn<ArtifactBodyProps['preview']>(async (_r, _signal, publish) => {
        receive = publish
        publish(liveFrame)
        await held.promise
      }),
    })
    await openReport()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    await act(async () => {
      receive!({ ...liveFrame, text: 'Stale frame' })
      if (outcome === 'resolve') held.resolve(undefined)
      else held.reject(new Error('old preview'))
      await held.promise.catch(() => {})
    })
    expect(screen.queryByText(/Stale frame|old preview/)).toBeNull()
    h.view.unmount()
  },
)
it.each(['save', 'ask', 'input'] as const)(
  'retires a pending trusted %s acknowledgement when the pane closes',
  async (action) => {
    const held = Promise.withResolvers<ArtifactRevision>()
    const ask = Promise.withResolvers<undefined>()
    const interaction = Promise.withResolvers<ArtifactFrame>()
    const h = mount({
      save: vi.fn(() => held.promise),
      ask: vi.fn(() => ask.promise),
      interact: vi.fn(() => interaction.promise),
      policy: enabledPolicy,
      preview: vi.fn<ArtifactBodyProps['preview']>(async (_r, signal, publish) => {
        publish(liveFrame)
        await new Promise<void>((resolve) =>{
          signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          ) },
        )
      }),
    })
    await openReport()
    if (action === 'save') {
      fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Source' }), { target: { value: 'Updated' } })
      fireEvent.click(screen.getByRole('button', { name: en.save }))
      await waitFor(() => {
        expect(h.props.save).toHaveBeenCalledOnce()
      })
    } else if (action === 'ask') {
      const source = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Source' })
      source.setSelectionRange(0, 6)
      fireEvent.change(screen.getByRole('textbox', { name: en.instruction }), {
        target: { value: 'Change selection' },
      })
      fireEvent.click(screen.getByRole('button', { name: en.request }))
      await waitFor(() => {
        expect(h.props.ask).toHaveBeenCalledOnce()
      })
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
      await screen.findByRole('img')
      fireEvent.click(screen.getByRole('button', { name: 'Tab' }))
      await waitFor(() => {
        expect(h.props.interact).toHaveBeenCalledOnce()
      })
    }
    h.view.unmount()
    await act(async () => {
      held.resolve(revision)
      ask.resolve(undefined)
      interaction.reject(new Error('closed interaction'))
      await Promise.allSettled([held.promise, ask.promise, interaction.promise])
    })
    expect(screen.queryByRole('complementary')).toBeNull()
  },
)
it('reports live input failure while preserving source and retires catalogue subscription failure after closure', async () => {
  const held = Promise.withResolvers<undefined>()
  let notify: (() => void) | undefined
  const h = mount({
    policy: enabledPolicy,
    interact: vi.fn(async () => {
      throw new Error('input failed')
    }),
    watch: vi.fn<ArtifactBodyProps['watch']>(async (_signal, changed) => {
      notify = changed
      await held.promise
    }),
    preview: vi.fn<ArtifactBodyProps['preview']>(async (_r, signal, publish) => {
      publish(liveFrame)
      await new Promise<void>((resolve) =>{
        signal.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        ) },
      )
    }),
  })
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('img')
  fireEvent.click(screen.getByRole('button', { name: 'Tab' }))
  await screen.findByText('Could not complete this action: input failed')
  const value = Promise.withResolvers<Awaited<ReturnType<ArtifactBodyProps['list']>>>()
  vi.mocked(h.props.list).mockImplementationOnce(() => value.promise)
  notify!()
  await waitFor(() => {
    expect(h.props.list).toHaveBeenCalledTimes(2)
  })
  h.view.unmount()
  await act(async () => {
    value.resolve({ items: [], next: null })
    held.reject(new Error('closed watch'))
    await Promise.allSettled([value.promise, held.promise])
  })
})
it.each(['refresh', 'page', 'recover'] as const)(
  'retires late %s inventory results after closure',
  async (action) => {
    const held = Promise.withResolvers<Awaited<ReturnType<ArtifactBodyProps['list']>>>()
    const h = mount({
      list: vi.fn(async () => ({
        items: [{ head: revision, revisionCount: 1 }],
        next: 'next' as ArtifactId,
      })),
      pending: vi.fn(async () =>
        action === 'recover'
          ? [
            {
              artifactId: revision.artifactId,
              revisionId: revision.revisionId,
              sessionId: revision.sessionId,
              operationId: revision.operationId,
              createdAt: revision.createdAt,
            },
          ]
          : [],
      ),
    })
    await screen.findByRole('button', { name: 'Report' })
    vi.mocked(h.props.list).mockImplementationOnce(() => held.promise)
    fireEvent.click(
      screen.getByRole('button', {
        name: action === 'refresh' ? 'Refresh' : action === 'page' ? 'Load more' : /Recover save/,
      }),
    )
    await waitFor(() => {
      expect(h.props.list).toHaveBeenCalledTimes(2)
    })
    h.view.unmount()
    await act(async () => {
      held.resolve({ items: [], next: null })
      await held.promise
    })
  },
)
it.each(['history', 'page', 'compare'] as const)(
  'retires late %s revision results after replacement',
  async (action) => {
    const histories = Promise.withResolvers<readonly ArtifactRevision[]>()
    const comparison = Promise.withResolvers<ArtifactContent>()
    const h = mount()
    await openReport()
    if (action === 'history') vi.mocked(h.props.history).mockImplementationOnce(() => histories.promise)
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    if (action !== 'history') {
      await screen.findByRole('button', { name: /2026-10-04.*revision/ })
      if (action === 'page') {
        vi.mocked(h.props.history).mockImplementationOnce(() => histories.promise)
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      } else {
        vi.mocked(h.props.read).mockImplementationOnce(() => comparison.promise)
        fireEvent.click(screen.getByRole('button', { name: 'Compare revisions' }))
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    await screen.findByRole('textbox', { name: 'Source' })
    await act(async () => {
      histories.resolve([revision])
      comparison.resolve(content)
      await Promise.all([histories.promise, comparison.promise])
    })
    expect(screen.queryByRole('textbox', { name: 'Selected revision' })).toBeNull()
  },
)
it('preserves an uncertain edit identity when a concurrent head makes restoration available', async () => {
  const h = mount({
    save: vi.fn(async () => {
      throw new Error('uncertain')
    }),
  })
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await screen.findByText('Could not complete this action: uncertain')
  vi.mocked(h.props.list).mockResolvedValueOnce({
    items: [{ head: { ...revision, revisionId: 'newer' as ArtifactRevisionId }, revisionCount: 2 }],
    next: null,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Restore as a new revision' }))
  expect(h.props.restore).not.toHaveBeenCalled()
  expect(h.props.save).toHaveBeenCalledOnce()
})
it('compares a retained binary asset without decoding it as source', async () => {
  const h = mount()
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: 'History' }))
  await screen.findByRole('button', { name: /2026-10-04.*revision/ })
  vi.mocked(h.props.read).mockResolvedValueOnce({
    ...content,
    asset: { ...content.asset, mediaType: 'application/octet-stream' },
    data: btoa('binary'),
  })
  fireEvent.click(screen.getByRole('button', { name: 'Compare revisions' }))
  await waitFor(() => {
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Selected revision' }).value).toBe(
      en.noText,
    )
  })
})

it('adopts an acknowledged edit as a new immutable selection and rereads its history', async () => {
  const updated = { ...revision, revisionId: 'updated' as ArtifactRevisionId, parent: revision.revisionId }
  const h = mount({
    save: vi.fn(async () => updated),
    read: vi.fn<ArtifactBodyProps['read']>(async value => ({
      ...content,
      revision: value,
      data: btoa(value.revisionId === updated.revisionId ? 'Updated' : original),
    })),
    history: vi.fn(async () => [updated, revision]),
  })
  await openReport()
  fireEvent.click(screen.getByRole('button', { name: en.edit }))
  fireEvent.change(screen.getByRole('textbox', { name: en.source }), { target: { value: 'Updated' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await waitFor(() => {
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: en.source }).value).toBe('Updated')
  })
  await waitFor(() => {
    expect(h.props.history).toHaveBeenCalledWith(revision.artifactId, null)
  })
  expect(screen.getByText('updated')).not.toBeNull()
})
