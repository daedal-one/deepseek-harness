/** Exact revision leases and catalogue stream revocation through the real API consumer. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { ArtifactsController } from '../src/index.ts'
import type { ArtifactContent, ArtifactRevision } from '@deepseek-ai/dsh-artifact/types'
import type { ArtifactFrame, ArtifactInvocation } from '@deepseek-ai/dsh-artifact-runtime/types'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})
function harness(runtime = true) {
  const ctx = new Context()
  contexts.push(ctx)
  const workspaces = new Set(['workspace', 'other'])
  ctx.provide('workspaceRegistry', {
    get: (id: string) => (workspaces.has(id) ? { id } : undefined),
  } as never)
  const noop = () => () => {}
  ctx.provide('typert', { lookups: { configure: noop }, contexts: { configureHost: noop } } as never)
  const revision = {
    workspaceId: 'workspace',
    artifactId: 'artifact',
    revisionId: 'revision',
    entry: 'index.html',
    assets: [{ name: 'index.html' }, { name: 'style.css' }],
  } as unknown as ArtifactRevision
  const read = vi.fn(
    async (_w: unknown, _a: unknown, _r: unknown, name: string) =>
      ({
        revision,
        asset: revision.assets.find(asset => asset.name === name),
        data: '',
      }) as ArtifactContent,
  )
  ctx.provide('artifacts', { read } as never)
  const controller = new ArtifactsController(ctx, {
    maxCatalogueWatchers: 1,
    maxRetainedBytes: 10000,
    maxEditBytes: 100,
    maxSelectionBytes: 100,
  })
  const ended = Promise.withResolvers<undefined>()
  const frame = {
    invocationId: 'invocation',
    revisionId: revision.revisionId,
    png: '',
    text: 'Ready',
    width: 640,
    height: 480,
  } as ArtifactFrame
  const close = vi.fn(async () => {
    ended.resolve(undefined)
  })
  const invocation = {
    id: frame.invocationId,
    ended: ended.promise,
    close,
    interact: vi.fn(async () => frame),
  } satisfies ArtifactInvocation
  const open = vi.fn(async (_input: unknown, signal: AbortSignal): Promise<ArtifactInvocation> => {
    signal.addEventListener(
      'abort',
      () => {
        void close()
      },
      { once: true },
    )
    return invocation
  })
  if (runtime) ctx.provide('artifactRuntime', { open } as never)
  return { ctx, controller, workspaces, revision, read, open, invocation, frame, ended }
}
it('coalesces exact-Workspace changes and releases subscription admission on cancellation', async () => {
  const h = harness(),
    cancel = new AbortController()
  const stream = h.controller.watch('workspace' as never, cancel.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value).toBe(true)
  await expect(
    h.controller
      .watch('other' as never, new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toThrow('limit')
  const next = stream.next()
  let resolved = false
  void next.then(
    () => {
      resolved = true
    },
    () => {},
  )
  h.ctx.emit('artifact/changed', 'other' as never)
  await Promise.resolve()
  expect(resolved).toBe(false)
  h.ctx.emit('artifact/changed', 'workspace' as never)
  h.ctx.emit('artifact/changed', 'workspace' as never)
  expect((await next).value).toBe(true)
  const stopped = stream.next()
  cancel.abort(new Error('closed'))
  await expect(stopped).rejects.toThrow('closed')
  const replacement = h.controller
    .watch('other' as never, new AbortController().signal)
    [Symbol.asyncIterator]()
  expect((await replacement.next()).value).toBe(true)
  await replacement.return!()
})
it('rejects a revoked Workspace stream and unknown Workspace at subscription', async () => {
  const h = harness()
  await expect(
    h.controller
      .watch('missing' as never, new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toThrow('Unknown')
  const stream = h.controller
    .watch('workspace' as never, new AbortController().signal)
    [Symbol.asyncIterator]()
  await stream.next()
  const next = stream.next()
  h.workspaces.delete('workspace')
  h.ctx.emit('domain/changed', {
    domain: 'workspace',
    table: 'workspaces',
    operation: 'deleted',
    key: 'workspace',
  } as never)
  await expect(next).rejects.toThrow('revoked')
})
it('captures complete assets and rejects cross-Workspace, cross-revision and retired invocation input', async () => {
  const h = harness(),
    cancel = new AbortController()
  const stream = h.controller
    .preview('workspace' as never, h.revision.artifactId, h.revision.revisionId, 'index.html', cancel.signal)
    [Symbol.asyncIterator]()
  expect((await stream.next()).value).toBe(h.frame)
  expect(h.open.mock.calls[0]![0]).toMatchObject({
    revision: h.revision,
    assets: [{ asset: { name: 'index.html' } }, { asset: { name: 'style.css' } }],
  })
  for (const [workspace, revision, id] of [
    ['other', 'revision', 'invocation'],
    ['workspace', 'foreign', 'invocation'],
    ['workspace', 'revision', 'foreign'],
  ])
    await expect(
      h.controller.interact(workspace as never, h.revision.artifactId, revision as never, id as never, {
        type: 'key',
        key: 'Tab',
      }),
    ).rejects.toThrow('lease')
  expect(
    await h.controller.interact(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      h.invocation.id,
      { type: 'key', key: 'Tab' },
    ),
  ).toBe(h.frame)
  cancel.abort()
  await stream.next()
  expect(h.invocation.close).toHaveBeenCalled()
  await expect(
    h.controller.interact(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      h.invocation.id,
      { type: 'key', key: 'Tab' },
    ),
  ).rejects.toThrow('lease')
})
it('retains failed revocation handles so plugin disposal can retry removal', async () => {
  const h = harness()
  const stream = h.controller
    .preview(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      'index.html',
      new AbortController().signal,
    )
    [Symbol.asyncIterator]()
  await stream.next()
  h.invocation.close.mockRejectedValueOnce(new Error('Engine unavailable'))
  h.workspaces.delete('workspace')
  h.ctx.emit('domain/changed', {
    domain: 'workspace',
    table: 'workspaces',
    operation: 'deleted',
    key: 'workspace',
  } as never)
  await vi.waitFor(() => {
    expect(h.invocation.close).toHaveBeenCalledTimes(1)
  })
  await h.ctx.fiber.dispose()
  expect(h.invocation.close).toHaveBeenCalledTimes(3)
  await stream.return!()
})

it('projects exact immutable catalogue, recovery, read and mutation identities through the API', async () => {
  const h = harness()
  const publish = vi.fn(async () => h.revision),
    restore = vi.fn(async () => h.revision)
  const list = vi.fn(async () => ({ items: [], next: null })),
    history = vi.fn(async () => [h.revision])
  const pending = vi.fn(async () => []),
    reconcile = vi.fn(async () => null)
  Object.assign(h.ctx.artifacts, { publish, restore, list, history, pending, reconcile })
  const w = 'workspace' as never,
    session = { id: 'editor' } as never,
    operation = 'operation' as never
  expect(h.controller.policy()).toEqual({
    previewAvailable: true,
    maxRetainedBytes: 10000,
    maxEditBytes: 100,
    maxSelectionBytes: 100,
  })
  await h.controller.list(w, null)
  await h.controller.history(w, h.revision.artifactId, h.revision.revisionId)
  await h.controller.pending(w)
  await h.controller.reconcile(w, h.revision.revisionId)
  const signal = new AbortController().signal
  await h.controller.read(w, h.revision.artifactId, h.revision.revisionId, 'index.html', signal)
  const request = { title: 'Published' } as never
  await h.controller.publish(session, request)
  await h.controller.restore(
    session,
    h.revision.artifactId,
    h.revision.revisionId,
    h.revision.revisionId,
    operation,
  )
  expect(list).toHaveBeenCalledWith(w, null)
  expect(history).toHaveBeenCalledWith(w, 'artifact', 'revision')
  expect(pending).toHaveBeenCalledWith(w)
  expect(reconcile).toHaveBeenCalledWith(w, 'revision')
  expect(h.read).toHaveBeenLastCalledWith(w, 'artifact', 'revision', 'index.html', signal)
  expect(publish).toHaveBeenCalledWith(session, request)
  expect(restore).toHaveBeenCalledWith(session, 'artifact', 'revision', 'revision', operation)
})
it('preserves profile and untouched assets when an authorized text edit appends a revision', async () => {
  const h = harness()
  const revision = {
    ...h.revision,
    title: 'Title',
    profile: 'document' as const,
    assets: [
      { name: 'index.html', mediaType: 'text/html' },
      { name: 'style.css', mediaType: 'text/css' },
    ],
  } as unknown as ArtifactRevision
  h.read.mockImplementation(async (_w, _a, _r, name) => ({
    revision,
    asset: revision.assets.find(asset => asset.name === name)!,
    data: btoa('Original'),
  }))
  const publish = vi.fn(async () => revision)
  Object.assign(h.ctx.artifacts, { publish })
  const session = { id: 'editor' } as never
  await h.controller.edit(
    session,
    'workspace' as never,
    revision.artifactId,
    revision.revisionId,
    'index.html',
    'Updated',
    'retry' as never,
  )
  expect(publish).toHaveBeenCalledWith(session, {
    operationId: 'retry',
    artifactId: 'artifact',
    expectedHead: 'revision',
    title: 'Title',
    entry: 'index.html',
    profile: 'document',
    assets: [
      { name: 'index.html', mediaType: 'text/html', data: btoa('Updated') },
      { name: 'style.css', mediaType: 'text/css', data: btoa('Original') },
    ],
  })
  await expect(
    h.controller.edit(
      session,
      'workspace' as never,
      revision.artifactId,
      revision.revisionId,
      'index.html',
      'x'.repeat(101),
      'retry' as never,
    ),
  ).rejects.toThrow('limit')
  expect(publish).toHaveBeenCalledOnce()
  for (const mediaType of ['application/json', 'image/svg+xml', 'image/png']) {
    h.read.mockResolvedValueOnce({
      revision: { ...revision, assets: [revision.assets[0]!] },
      asset: { ...revision.assets[0]!, mediaType },
      data: '',
    })
    const result = h.controller.edit(
      session,
      'workspace' as never,
      revision.artifactId,
      revision.revisionId,
      'index.html',
      'Updated',
      'retry' as never,
    )
    if (mediaType === 'image/png') await expect(result).rejects.toThrow('text asset')
    else await expect(result).resolves.toBe(revision)
  }
})
it('reports runtime unavailability and refuses a non-entry preview without allocating', async () => {
  const h = harness(),
    signal = new AbortController().signal
  await expect(
    h.controller
      .preview('workspace' as never, h.revision.artifactId, h.revision.revisionId, 'style.css', signal)
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toThrow('immutable entry')
  expect(h.open).not.toHaveBeenCalled()
  const unavailable = harness(false)
  expect(unavailable.controller.policy().previewAvailable).toBe(false)
  await expect(
    unavailable.controller
      .preview('workspace' as never, h.revision.artifactId, h.revision.revisionId, 'index.html', signal)
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toThrow('unavailable')
})
it('awaits and retires a cancelled pending allocation without emitting an initial frame', async () => {
  const h = harness(),
    started = Promise.withResolvers<AbortSignal>(),
    allocation = Promise.withResolvers<ArtifactInvocation>()
  h.open.mockImplementationOnce((_input, signal) => {
    started.resolve(signal)
    return allocation.promise
  })
  const stream = h.controller
    .preview(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      'index.html',
      new AbortController().signal,
    )
    [Symbol.asyncIterator]()
  const next = stream.next()
  void next.catch(() => {
    /* The cancellation assertion below owns this expected rejection. */
  })
  const signal = await started.promise
  const disposing = h.ctx.fiber.dispose()
  await vi.waitFor(() => {
    expect(signal.aborted).toBe(true)
  })
  allocation.resolve(h.invocation)
  await expect(next).rejects.toThrow()
  await disposing
  expect(h.invocation.close).toHaveBeenCalledOnce()
  expect(h.invocation.interact).not.toHaveBeenCalled()
})
it('retires an allocation if the Workspace disappears before its runtime is ready', async () => {
  const h = harness(),
    started = Promise.withResolvers<undefined>(),
    allocation = Promise.withResolvers<ArtifactInvocation>()
  h.open.mockImplementationOnce(() => {
    started.resolve(undefined)
    return allocation.promise
  })
  const next = h.controller
    .preview(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      'index.html',
      new AbortController().signal,
    )
    [Symbol.asyncIterator]()
    .next()
  await started.promise
  h.workspaces.delete('workspace')
  allocation.resolve(h.invocation)
  await expect(next).rejects.toThrow('revoked during')
  expect(h.invocation.close).toHaveBeenCalledOnce()
})
it('retains a failed revocation lease for disposal cleanup while refusing subsequent input', async () => {
  const h = harness()
  const stream = h.controller
    .preview(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      'index.html',
      new AbortController().signal,
    )
    [Symbol.asyncIterator]()
  await stream.next()
  vi.mocked(h.invocation.close).mockRejectedValueOnce(new Error('engine disconnected'))
  h.workspaces.delete('workspace')
  h.ctx.emit('domain/changed', {
    domain: 'workspace',
    table: 'workspaces',
    operation: 'deleted',
    key: 'workspace',
  } as never)
  await vi.waitFor(() => {
    expect(h.invocation.close).toHaveBeenCalledOnce()
  })
  await expect(
    h.controller.interact(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      h.invocation.id,
      { type: 'key', key: 'Tab' },
    ),
  ).rejects.toThrow('lease')
  await h.ctx.fiber.dispose()
  expect(h.invocation.close).toHaveBeenCalledTimes(3)
  await stream.next()
})

it('coalesces a change received while the catalogue consumer is suspended and ignores unrelated domain mutations', async () => {
  const h = harness()
  const controller = new AbortController()
  const stream = h.controller.watch('workspace' as never, controller.signal)[Symbol.asyncIterator]()
  await stream.next()
  for (const change of [
    { domain: 'other', table: 'workspaces', operation: 'deleted', key: 'workspace' },
    { domain: 'workspace', table: 'other', operation: 'deleted', key: 'workspace' },
    { domain: 'workspace', table: 'workspaces', operation: 'updated', key: 'workspace' },
    { domain: 'workspace', table: 'workspaces', operation: 'deleted', key: 'other' },
  ])
    h.ctx.emit('domain/changed', change as never)
  h.ctx.emit('artifact/changed', 'workspace' as never)
  expect((await stream.next()).value).toBe(true)
  await stream.return!()
})
it('revokes only the previews owned by a deleted Workspace', async () => {
  const h = harness()
  const stream = h.controller
    .preview(
      'workspace' as never,
      h.revision.artifactId,
      h.revision.revisionId,
      'index.html',
      new AbortController().signal,
    )
    [Symbol.asyncIterator]()
  await stream.next()
  h.ctx.emit('domain/changed', {
    domain: 'workspace',
    table: 'workspaces',
    operation: 'deleted',
    key: 'other',
  } as never)
  expect(h.invocation.close).not.toHaveBeenCalled()
  h.workspaces.delete('workspace')
  h.ctx.emit('domain/changed', {
    domain: 'workspace',
    table: 'workspaces',
    operation: 'deleted',
    key: 'workspace',
  } as never)
  await h.invocation.ended
  await stream.next()
  expect(h.invocation.close).toHaveBeenCalled()
})
