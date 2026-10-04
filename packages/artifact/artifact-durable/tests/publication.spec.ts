/** Publication, retry, quota, and ownership behavior through the real durable provider. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { FileAttachmentRef, AttachmentIdType } from '@deepseek-ai/dsh-attachment'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { ArtifactPublish, ArtifactOperationId } from '@deepseek-ai/dsh-artifact'
import { DurableArtifacts } from '../src/index.ts'
import { revisionSchema } from '../src/schema.ts'
import type { Ledger, Receipt } from '../src/schema.ts'
import type { Config } from '../src/index.ts'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const config: Config = {
  maxQueuedOperations: 20,
  maxConcurrentReads: 4,
  readTimeoutMs: 10000,
  maxResponseBytes: 65536,
  maxRevisionsPerInterval: 100,
  revisionIntervalMs: 1000,
  maxAssetBytes: 4096,
  maxPublicationBytes: 16384,
  maxAssets: 8,
  maxMetadataBytes: 2048,
  maxWorkspaceBytes: 1000000,
  maxHostBytes: 4000000,
  maxOperations: 100,
  maxRevisionsPerArtifact: 10,
  pageSize: 2,
}
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})
const request = (text = '<button>Press</button>'): ArtifactPublish => ({
  operationId: randomUUID() as ArtifactOperationId,
  artifactId: null,
  expectedHead: null,
  title: 'Counter',
  entry: 'index.html',
  profile: 'interactive-local',
  assets: [{ name: 'index.html', mediaType: 'text/html', data: Buffer.from(text).toString('base64') }],
})

async function harness(
  options: {
    pool?: MemoryMediaPool
    durable?: Map<string, readonly SessionEvent[]>
    files?: Map<string, Buffer>
    config?: Config
  } = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  const pool = options.pool ?? new MemoryMediaPool()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionStore)
  let created: Session | undefined
  const publisher = ctx.plugin({
    inject: ['sessions'],
    apply(owner: Context) {
      created = owner.sessions.create(
        SessionId('publisher'),
        options.durable?.has('publisher') ? { seed: options.durable.get('publisher')! } : {},
      )
    },
  })
  await publisher
  if (created === undefined) throw new Error('Publisher fixture was not created.')
  const session = created
  const other = ctx.sessions.create(SessionId('other'))
  const workspaceId = 'workspace-a' as WorkspaceId
  const otherWorkspaceId = 'workspace-b' as WorkspaceId
  const workspaces = [
    { id: workspaceId, sessionIds: [session.id] },
    { id: otherWorkspaceId, sessionIds: [other.id] },
  ]
  ctx.provide('workspaceRegistry', {
    list: () => workspaces,
    get: (id: WorkspaceId) => workspaces.find(item => item.id === id),
  } as never)
  const durable = options.durable ?? new Map<string, readonly SessionEvent[]>()
  let failFlush = 0
  const stopFlush = ctx.on('session/flush', (live) => {
    if (--failFlush === 0) throw new Error('checkpoint failed')
    durable.set(live.id, [...live.snapshotEvents()])
  })
  ctx.provide('sessionPersistence', {
    stat: async (id: string) => (durable.has(id) ? {} : undefined),
    open: async (id: string) => ({
      read: async () => ({ events: durable.get(id) ?? [] }),
      close: async () => {},
    }),
  } as never)
  const files = options.files ?? new Map<string, Buffer>()
  let saves = 0
  ctx.provide('attachments', {
    saveFile: async ({ data, name }: { data: Uint8Array; name: string }) => {
      saves++
      const id = randomUUID()
      files.set(id, Buffer.from(data))
      return {
        attachmentId: id as AttachmentIdType,
        name,
        bytes: data.byteLength,
      } satisfies FileAttachmentRef
    },
    readFileStream: async function* (ref: FileAttachmentRef) {
      const bytes = files.get(ref.attachmentId)
      if (bytes === undefined) throw new Error('missing blob')
      yield bytes
    },
  } as never)
  await ctx.plugin(DurableArtifacts, options.config ?? config)
  return {
    ctx,
    pool,
    session,
    publisher,
    other,
    workspaceId,
    otherWorkspaceId,
    workspaces,
    durable,
    files,
    saves: () => saves,
    stopFlush,
    failSecondFlush: () => {
      failFlush = 2
    },
  }
}

describe('durable artifact publication', () => {
  it('stores exact bytes and durable provenance before exposing a Workspace head', async () => {
    const h = await harness()
    const input = request()
    const revision = await h.ctx.artifacts.publish(h.session, input)
    expect(h.durable.get(h.session.id)?.at(-1)).toMatchObject({
      type: 'artifact/published',
      data: { revision },
    })
    expect(await h.ctx.artifacts.list(h.workspaceId, null)).toMatchObject({
      items: [{ head: revision, revisionCount: 1 }],
      next: null,
    })
    expect(
      (await h.ctx.artifacts.read(h.workspaceId, revision.artifactId, revision.revisionId, revision.entry))
        .data,
    ).toBe(input.assets[0]!.data)
    expect(await h.ctx.artifacts.publish(h.session, input)).toEqual(revision)
    expect(h.saves()).toBe(1)
    await expect(h.ctx.artifacts.publish(h.session, { ...input, title: 'Different' })).rejects.toThrow(
      'reused',
    )
  })
  it('retains revisions across provider restart and Session inactivity', async () => {
    const h = await harness()
    const revision = await h.ctx.artifacts.publish(h.session, request())
    await h.ctx.fiber.dispose()
    const next = await harness(h)
    expect((await next.ctx.artifacts.list(h.workspaceId, null)).items[0]?.head).toEqual(revision)
    expect(
      (await next.ctx.artifacts.read(h.workspaceId, revision.artifactId, revision.revisionId, revision.entry))
        .revision,
    ).toEqual(revision)
  })
  it('rejects cross-Workspace reads, history, restore, and edits at the provider', async () => {
    const h = await harness()
    const revision = await h.ctx.artifacts.publish(h.session, request())
    await expect(
      h.ctx.artifacts.read(h.otherWorkspaceId, revision.artifactId, revision.revisionId, revision.entry),
    ).rejects.toThrow('Workspace')
    await expect(h.ctx.artifacts.history(h.otherWorkspaceId, revision.artifactId, null)).rejects.toThrow(
      'Workspace',
    )
    await expect(
      h.ctx.artifacts.publish(h.other, {
        ...request(),
        artifactId: revision.artifactId,
        expectedHead: revision.revisionId,
      }),
    ).rejects.toThrow('Workspace')
    await expect(
      h.ctx.artifacts.restore(
        h.other,
        revision.artifactId,
        revision.revisionId,
        revision.revisionId,
        randomUUID() as ArtifactOperationId,
      ),
    ).rejects.toThrow('Workspace')
  })
  it('allows exactly one of two concurrent updates from the same observed head', async () => {
    const h = await harness()
    const first = await h.ctx.artifacts.publish(h.session, request())
    const results = await Promise.allSettled(
      [1, 2].map(n =>
        h.ctx.artifacts.publish(h.session, {
          ...request(String(n)),
          artifactId: first.artifactId,
          expectedHead: first.revisionId,
        }),
      ),
    )
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const history = await h.ctx.artifacts.history(h.workspaceId, first.artifactId, null)
    expect(history).toHaveLength(2)
    expect(history[1]).toEqual(first)
    const restored = await h.ctx.artifacts.restore(
      h.session,
      first.artifactId,
      first.revisionId,
      history[0]!.revisionId,
      randomUUID() as ArtifactOperationId,
    )
    expect(restored).toMatchObject({ parent: history[0]!.revisionId, restoredFrom: first.revisionId })
    expect((await h.ctx.artifacts.history(h.workspaceId, first.artifactId, null))[0]).toEqual(restored)
  })
  it('does not expose a publication whose durability acknowledgement failed and retries without duplicating its event', async () => {
    const h = await harness()
    const input = request()
    h.failSecondFlush()
    await expect(h.ctx.artifacts.publish(h.session, input)).rejects.toThrow('checkpoint failed')
    expect((await h.ctx.artifacts.list(h.workspaceId, null)).items).toEqual([])
    const revision = await h.ctx.artifacts.publish(h.session, input)
    expect(h.session.snapshotEvents().filter(event => event.type === 'artifact/published')).toHaveLength(1)
    expect(h.saves()).toBe(1)
    expect((await h.ctx.artifacts.list(h.workspaceId, null)).items[0]?.head).toEqual(revision)
  })
  it('reconciles an interrupted save from its exact Session event and clears the pending list', async () => {
    const h = await harness()
    const input = request()
    h.failSecondFlush()
    await expect(h.ctx.artifacts.publish(h.session, input)).rejects.toThrow('checkpoint failed')
    const pending = await h.ctx.artifacts.pending(h.workspaceId)
    expect(pending).toHaveLength(1)
    await expect(h.ctx.artifacts.reconcile(h.otherWorkspaceId, pending[0]!.revisionId)).rejects.toThrow(
      'absent',
    )
    const recovered = await h.ctx.artifacts.reconcile(h.workspaceId, pending[0]!.revisionId)
    expect(recovered?.operationId).toBe(input.operationId)
    expect(await h.ctx.artifacts.pending(h.workspaceId)).toEqual([])
    expect(await h.ctx.artifacts.publish(h.session, input)).toEqual(recovered)
  })
  it('enforces publication rate while allowing an existing committed retry', async () => {
    const h = await harness({
      config: Object.assign({}, config, { revisionIntervalMs: 86400000, maxRevisionsPerInterval: 1 }),
    })
    const input = request()
    const revision = await h.ctx.artifacts.publish(h.session, input)
    await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('rate limit')
    expect(await h.ctx.artifacts.publish(h.session, input)).toEqual(revision)
  })
  it('recovers a durable event when the catalogue commit failed', async () => {
    const h = await harness()
    const input = request()
    const remove = h.ctx.on('session/flush', (session: Session) => {
      if (session.snapshotEvents().some(event => event.type === 'artifact/published'))
        h.pool.failNextWrites = 1
    })
    await expect(h.ctx.artifacts.publish(h.session, input)).rejects.toThrow('injected write failure')
    remove()
    await h.ctx.fiber.dispose()
    const next = await harness(h)
    expect((await next.ctx.artifacts.list(h.workspaceId, null)).items).toHaveLength(1)
    expect(await next.ctx.artifacts.publish(next.session, input)).toMatchObject({
      operationId: input.operationId,
    })
    expect(next.saves()).toBe(0)
  })
  it.each(['../secret', '/absolute', 'a/../secret', 'https://evil/file', 'a//b', 'a/%2e%2e/file', 'a\\b'])(
    'refuses noncanonical asset name %s before persistence',
    async (name) => {
      const h = await harness()
      const input = request()
      await expect(
        h.ctx.artifacts.publish(h.session, {
          ...input,
          entry: name,
          assets: [{ ...input.assets[0]!, name }],
        }),
      ).rejects.toThrow('canonical')
      expect(h.saves()).toBe(0)
    },
  )
  it('refuses duplicate assets, unknown profiles, excessive content, malformed encoding, and absent entries', async () => {
    const h = await harness()
    const input = request()
    for (const invalid of [
      { ...input, assets: [...input.assets, ...input.assets] },
      { ...input, profile: 'host' },
      { ...input, assets: [{ ...input.assets[0]!, data: Buffer.alloc(4097).toString('base64') }] },
      { ...input, assets: [{ ...input.assets[0]!, data: 'YWJj=' }] },
      { ...input, entry: 'missing.html' },
    ])
      await expect(h.ctx.artifacts.publish(h.session, invalid as ArtifactPublish)).rejects.toThrow()
    expect(h.saves()).toBe(0)
  })
  it('refuses mutated saved bytes and unknown revision asset requests', async () => {
    const h = await harness()
    const revision = await h.ctx.artifacts.publish(h.session, request())
    await expect(
      h.ctx.artifacts.read(h.workspaceId, revision.artifactId, revision.revisionId, 'extra.js'),
    ).rejects.toThrow('absent')
    h.files.set(revision.assets[0]!.file.attachmentId, Buffer.from('corrupt'))
    await expect(
      h.ctx.artifacts.read(h.workspaceId, revision.artifactId, revision.revisionId, revision.entry),
    ).rejects.toThrow('integrity')
  })
  it('stops admission at the retention cap while preserving readable history', async () => {
    const h = await harness({ config: Object.assign({}, config, { maxOperations: 1 }) })
    const revision = await h.ctx.artifacts.publish(h.session, request())
    await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('limit')
    expect((await h.ctx.artifacts.history(h.workspaceId, revision.artifactId, null))[0]).toEqual(revision)
  })
})

it('keeps exact inherited revision references and requires a current Workspace attachment for fork publications', async () => {
  const h = await harness()
  const first = await h.ctx.artifacts.publish(h.session, request())
  const child = h.ctx.sessions.fork(h.session)
  expect(child.snapshotEvents().find(event => event.type === 'artifact/published')).toMatchObject({
    data: { revision: first },
  })
  await expect(
    h.ctx.artifacts.publish(child, {
      ...request(),
      artifactId: first.artifactId,
      expectedHead: first.revisionId,
    }),
  ).rejects.toThrow('attachment')
  h.workspaces[0]!.sessionIds.push(child.id)
  const next = await h.ctx.artifacts.publish(child, {
    ...request(),
    artifactId: first.artifactId,
    expectedHead: first.revisionId,
  })
  expect(next).toMatchObject({ parent: first.revisionId, sessionId: child.id, workspaceId: h.workspaceId })
  expect(
    child
      .snapshotEvents()
      .filter(event => event.type === 'artifact/published')
      .map(event => event.data.revision.revisionId),
  ).toEqual([first.revisionId, next.revisionId])
})
it('paginates exact artifact identities and immutable history while refusing foreign cursors', async () => {
  const h = await harness()
  const first = await h.ctx.artifacts.publish(h.session, request())
  await h.ctx.artifacts.publish(h.session, request())
  await h.ctx.artifacts.publish(h.session, request())
  const page = await h.ctx.artifacts.list(h.workspaceId, null)
  expect(page.items).toHaveLength(2)
  const final = await h.ctx.artifacts.list(h.workspaceId, page.next)
  expect(final.items).toHaveLength(1)
  expect(final.next).toBeNull()
  await expect(h.ctx.artifacts.list(h.workspaceId, 'foreign' as never)).rejects.toThrow('cursor')
  const next = await h.ctx.artifacts.publish(h.session, {
    ...request(),
    artifactId: first.artifactId,
    expectedHead: first.revisionId,
  })
  expect(await h.ctx.artifacts.history(h.workspaceId, first.artifactId, next.revisionId)).toEqual([first])
  await expect(h.ctx.artifacts.history(h.workspaceId, first.artifactId, 'foreign' as never)).rejects.toThrow(
    'cursor',
  )
  await expect(
    h.ctx.artifacts.read(h.workspaceId, first.artifactId, 'foreign' as never, first.entry),
  ).rejects.toThrow('Revision')
})
it.each(['maxWorkspaceBytes', 'maxHostBytes'] as const)(
  'reserves storage against %s without destroying an existing revision',
  async (limit) => {
    const limits = Object.assign({}, config, {
      maxAssetBytes: 128,
      maxPublicationBytes: 512,
      maxMetadataBytes: 2048,
      maxWorkspaceBytes: 3000,
      maxHostBytes: limit === 'maxHostBytes' ? 3000 : 10000,
    })
    const h = await harness({ config: limits })
    const first = await h.ctx.artifacts.publish(h.session, request())
    await expect(
      h.ctx.artifacts.publish(limit === 'maxHostBytes' ? h.other : h.session, request()),
    ).rejects.toThrow('storage admission')
    expect(
      (await h.ctx.artifacts.read(h.workspaceId, first.artifactId, first.revisionId, first.entry)).revision,
    ).toBe(first)
  },
)
it('caps retained revisions, complete responses and complete metadata before acknowledgement', async () => {
  const h = await harness({ config: Object.assign({}, config, { maxRevisionsPerArtifact: 1 }) })
  const first = await h.ctx.artifacts.publish(h.session, request())
  await expect(
    h.ctx.artifacts.publish(h.session, {
      ...request(),
      artifactId: first.artifactId,
      expectedHead: first.revisionId,
    }),
  ).rejects.toThrow('revision admission')
  const response = await harness({ config: Object.assign({}, config, { maxResponseBytes: 1 }) })
  await expect(response.ctx.artifacts.publish(response.session, request())).rejects.toThrow('response')
  expect(response.session.snapshotEvents().some(event => event.type === 'artifact/published')).toBe(false)
  const metadata = await harness({ config: Object.assign({}, config, { maxMetadataBytes: 400 }) })
  await expect(metadata.ctx.artifacts.publish(metadata.session, request())).rejects.toThrow('receipt')
  expect(metadata.session.snapshotEvents().some(event => event.type === 'artifact/published')).toBe(false)
})
it('refuses capture-time remote and undeclared dependencies without storing bytes or events', async () => {
  const h = await harness()
  for (const html of ['<img src="https://external.invalid/image">', '<script src="missing.js"></script>'])
    await expect(h.ctx.artifacts.publish(h.session, request(html))).rejects.toThrow('dependency')
  expect(h.saves()).toBe(0)
  expect(h.session.snapshotEvents().some(event => event.type === 'artifact/published')).toBe(false)
})
it('owns cancellation, concurrent reader admission and quiescent reader disposal', async () => {
  const h = await harness({ config: Object.assign({}, config, { maxConcurrentReads: 1 }) })
  const first = await h.ctx.artifacts.publish(h.session, request())
  const started = Promise.withResolvers<AbortSignal>()
  h.ctx.attachments.readFileStream = async function* (_ref, signal) {
    if (signal === undefined) throw new Error('reader requires cancellation')
    started.resolve(signal)
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    signal.throwIfAborted()
  }
  const reading = h.ctx.artifacts.read(h.workspaceId, first.artifactId, first.revisionId, first.entry)
  void reading.catch(() => {
    /* Disposal assertion owns this expected rejection. */
  })
  const stopped = await started.promise
  const provider = h.ctx.artifacts
  await expect(
    h.ctx.artifacts.read(h.workspaceId, first.artifactId, first.revisionId, first.entry),
  ).rejects.toThrow('concurrency')
  await h.ctx.fiber.dispose()
  await expect(reading).rejects.toThrow()
  expect(stopped.aborted).toBe(true)
  await expect(provider.publish(h.session, request())).rejects.toThrow('closing')
})
it('stops a stalled read at its configured deadline and refuses oversized immutable chunks', async () => {
  const h = await harness({ config: Object.assign({}, config, { readTimeoutMs: 25 }) })
  const first = await h.ctx.artifacts.publish(h.session, request())
  const originalRead = h.ctx.attachments.readFileStream.bind(h.ctx.attachments)
  h.ctx.attachments.readFileStream = async function* (_ref, signal) {
    if (signal === undefined) throw new Error('reader requires cancellation')
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    signal.throwIfAborted()
  }
  await expect(
    h.ctx.artifacts.read(h.workspaceId, first.artifactId, first.revisionId, first.entry),
  ).rejects.toThrow('deadline')
  h.ctx.attachments.readFileStream = originalRead
  h.files.set(first.assets[0]!.file.attachmentId, Buffer.alloc(4097))
  await expect(
    h.ctx.artifacts.read(h.workspaceId, first.artifactId, first.revisionId, first.entry),
  ).rejects.toThrow('length')
})
it('refuses queued admission and awaits its accepted publication on disposal', async () => {
  const h = await harness({ config: Object.assign({}, config, { maxQueuedOperations: 1 }) })
  const started = Promise.withResolvers<undefined>(),
    released = Promise.withResolvers<undefined>()
  const remove = h.ctx.on('session/flush', async () => {
    started.resolve(undefined)
    await released.promise
  })
  const saving = h.ctx.artifacts.publish(h.session, request())
  await started.promise
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('queue')
  released.resolve(undefined)
  await saving
  remove()
})
it('abandons a cold interrupted capture without erasing its retained quota reservation', async () => {
  const h = await harness()
  h.ctx.attachments.saveFile = async () => {
    throw new Error('capture failed')
  }
  const input = request()
  await expect(h.ctx.artifacts.publish(h.session, input)).rejects.toThrow('capture failed')
  const [pending] = await h.ctx.artifacts.pending(h.workspaceId)
  expect(pending).toBeDefined()
  await h.ctx.fiber.dispose()
  h.durable.delete(h.session.id)
  const cold = await harness(h)
  expect(await cold.ctx.artifacts.reconcile(h.workspaceId, pending!.revisionId)).toBeNull()
  expect(await cold.ctx.artifacts.reconcile(h.workspaceId, pending!.revisionId)).toBeNull()
  expect(await cold.ctx.artifacts.pending(h.workspaceId)).toEqual([])
  await expect(cold.ctx.artifacts.publish(cold.session, input)).rejects.toThrow('reconciled')
})
it('reconciles committed and cold uncertain evidence without activating its creating Session', async () => {
  const h = await harness()
  const input = request()
  h.failSecondFlush()
  await expect(h.ctx.artifacts.publish(h.session, input)).rejects.toThrow('checkpoint')
  const event = h.session.snapshotEvents().find(value => value.type === 'artifact/published')!
  h.durable.set('publisher', [...h.session.snapshotEvents()])
  await h.publisher.dispose()
  expect(h.ctx.sessions.get(h.session.id)).toBeUndefined()
  const value = await h.ctx.artifacts.reconcile(h.workspaceId, event.data.revision.revisionId)
  expect(value).toEqual(event.data.revision)
  expect(await h.ctx.artifacts.reconcile(h.workspaceId, value!.revisionId)).toBe(value)
})

function storedLedger(pool: MemoryMediaPool): { global: unknown } {
  const medium = [...pool.media.values()].find(
    item => typeof item.global === 'object' && item.global !== null && 'operations' in item.global,
  )
  if (medium === undefined) throw new Error('Artifact ledger fixture is absent.')
  return medium
}

it.each([
  [
    'operation identity',
    (ledger: Ledger) => {
      ledger.operations.push({ ...ledger.operations[0]!, revisionId: randomUUID() as never })
    },
  ],
  [
    'revision identity',
    (ledger: Ledger) => {
      ledger.operations.push({ ...ledger.operations[0]!, operationId: randomUUID() as never })
    },
  ],
  [
    'Workspace ownership',
    (ledger: Ledger) => {
      ledger.operations.push({
        ...ledger.operations[0]!,
        operationId: randomUUID() as never,
        revisionId: randomUUID() as never,
        workspaceId: 'other' as never,
      })
    },
  ],
  [
    'abandoned commit',
    (ledger: Ledger) => {
      ledger.operations[0]!.abandoned = true
    },
  ],
  [
    'retained quota',
    (ledger: Ledger) => {
      ledger.operations[0]!.chargedBytes = 0
    },
  ],
  [
    'missing manifest',
    (ledger: Ledger) => {
      ledger.operations[0]!.revision = null
    },
  ],
  ...(['artifactId', 'revisionId', 'workspaceId', 'sessionId', 'operationId', 'createdAt'] as const).map(
    key =>
      [
        'divergent ' + key,
        (ledger: Ledger) => {
          const revision = ledger.operations[0]!.revision!
          Object.assign(revision, {
            [key]:
              key === 'createdAt'
                ? '2000-01-01T00:00:00.000Z'
                : key === 'workspaceId' || key === 'sessionId'
                  ? 'different'
                  : randomUUID(),
          })
        },
      ] as const,
  ),
  [
    'revision parent',
    (ledger: Ledger) => {
      ledger.operations[0]!.revision = { ...ledger.operations[0]!.revision!, parent: randomUUID() as never }
    },
  ],
] as const)('refuses reopening a durable ledger with corrupt %s', async (_name, corrupt) => {
  const h = await harness()
  await h.ctx.artifacts.publish(h.session, request())
  await h.ctx.fiber.dispose()
  const medium = storedLedger(h.pool)
  const ledger = structuredClone(medium.global) as Ledger
  corrupt(ledger)
  medium.global = ledger
  await expect(harness(h)).rejects.toThrow()
})

it.each(['missing-session', 'missing-event', 'conflicting-event'] as const)(
  'refuses committed manifests with %s durable evidence',
  async (mode) => {
    const h = await harness()
    await h.ctx.artifacts.publish(h.session, request())
    await h.ctx.fiber.dispose()
    if (mode === 'missing-session') h.durable.delete(h.session.id)
    else if (mode === 'missing-event') h.durable.set(h.session.id, [])
    else
      h.durable.set(
        h.session.id,
        h.durable
          .get(h.session.id)!
          .map(event =>
            event.type === 'artifact/published'
              ? { ...event, data: { revision: { ...event.data.revision, title: 'Conflicting' } } }
              : event,
          ),
      )
    await expect(harness(h)).rejects.toThrow('durable')
  },
)

it('retains an uncommitted manifest with absent Session evidence until explicit reconciliation', async () => {
  const h = await harness()
  h.failSecondFlush()
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('checkpoint')
  await h.ctx.fiber.dispose()
  h.durable.delete(h.session.id)
  const cold = await harness(h)
  await cold.publisher.dispose()
  const pending = await cold.ctx.artifacts.pending(h.workspaceId)
  expect(pending).toHaveLength(1)
  expect(await cold.ctx.artifacts.reconcile(h.workspaceId, pending[0]!.revisionId)).toBeNull()
  expect(await cold.ctx.artifacts.reconcile(h.workspaceId, pending[0]!.revisionId)).toBeNull()
  await expect(cold.ctx.artifacts.reconcile(h.workspaceId, randomUUID() as never)).rejects.toThrow('absent')
})

it.each([
  (value: Receipt) => {
    value.revision = { ...value.revision!, profile: 'document', capabilities: ['published-assets'] }
  },
  (value: Receipt) => {
    value.revision = { ...value.revision!, capabilities: ['published-assets'] }
  },
  (value: Receipt) => {
    value.revision = { ...value.revision!, profile: 'document' }
  },
  (value: Receipt) => {
    value.revision = { ...value.revision!, assets: [] }
  },
  (value: Receipt) => {
    value.revision = { ...value.revision!, assets: [...value.revision!.assets, ...value.revision!.assets] }
  },
  (value: Receipt) => {
    value.revision = { ...value.revision!, entry: 'absent.html' }
  },
])('validates the closed persisted profile and complete manifest', async (change) => {
  const h = await harness()
  await h.ctx.artifacts.publish(h.session, request())
  const value = structuredClone((storedLedger(h.pool).global as Ledger).operations[0]!)
  change(value)
  expect(revisionSchema.safeParse(value.revision).success).toBe(
    value.revision!.profile === 'document' && value.revision!.capabilities.length === 1,
  )
})

it.each([{ maxAssetBytes: 20000 }, { maxPublicationBytes: 2000000 }, { maxWorkspaceBytes: 5000000 }])(
  'refuses inverted configured byte limits before opening storage',
  async (change) => {
    await expect(harness({ config: Object.assign({}, config, { ...change }) })).rejects.toThrow('increase')
  },
)

it('refuses an oversized empty reservation before capturing bytes', async () => {
  const h = await harness({ config: Object.assign({}, config, { maxMetadataBytes: 300 }) })
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('reservation')
  expect(h.saves()).toBe(0)
  expect(await h.ctx.artifacts.pending(h.workspaceId)).toEqual([])
})

it('rejects missing persistence acknowledgement and a Session no longer owned by the live registry', async () => {
  const h = await harness()
  h.stopFlush()
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('acknowledgement')
  expect(h.saves()).toBe(0)
  await h.publisher.dispose()
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('exact live')
})
it('revokes publication when Workspace membership disappears during immutable capture', async () => {
  const h = await harness()
  const save = h.ctx.attachments.saveFile.bind(h.ctx.attachments)
  h.ctx.attachments.saveFile = async (input) => {
    const result = await save(input)
    h.workspaces[0]!.sessionIds = []
    return result
  }
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('attachment')
  expect((await h.ctx.artifacts.list(h.workspaceId, null)).items).toEqual([])
})
it('revokes acknowledgement when Workspace membership disappears during the publication checkpoint', async () => {
  const h = await harness()
  h.ctx.on('session/flush', (live) => {
    if (live.snapshotEvents().some(event => event.type === 'artifact/published'))
      h.workspaces[0]!.sessionIds = []
  })
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('attachment')
  expect((await h.ctx.artifacts.list(h.workspaceId, null)).items).toEqual([])
})
it('requires reconciliation before a different operation can replace an unresolved artifact update', async () => {
  const h = await harness()
  const first = await h.ctx.artifacts.publish(h.session, request())
  const update = { ...request(), artifactId: first.artifactId, expectedHead: first.revisionId }
  h.failSecondFlush()
  await expect(h.ctx.artifacts.publish(h.session, update)).rejects.toThrow('checkpoint')
  await expect(
    h.ctx.artifacts.publish(h.session, { ...update, operationId: randomUUID() as never }),
  ).rejects.toThrow('unresolved')
  const pending = (await h.ctx.artifacts.pending(h.workspaceId))[0]!
  await h.publisher.dispose()
  const events = h.durable.get(h.session.id)!
  const ledger = storedLedger(h.pool).global as Ledger
  const receipt = ledger.operations.find(item => item.revisionId === pending.revisionId)!
  h.durable.set(h.session.id, [
    ...events.filter(
      event => event.type !== 'artifact/published' || event.data.revision.revisionId !== pending.revisionId,
    ),
    {
      id: randomUUID(),
      type: 'artifact/published',
      data: { revision: { ...receipt.revision!, title: 'Conflicting' } },
      createdAt: Date.now(),
    } as unknown as SessionEvent,
  ])
  await expect(h.ctx.artifacts.reconcile(h.workspaceId, pending.revisionId)).rejects.toThrow('conflicts')
})
it.each([
  { operationId: 'invalid' },
  { title: ' ' },
  { profile: 'unsupported' },
  { artifactId: randomUUID(), expectedHead: null },
  { artifactId: null, expectedHead: randomUUID() },
  { assets: [] },
  { assets: Array.from({ length: 9 }, () => request().assets[0]!) },
  { assets: [{ ...request().assets[0]!, mediaType: 'application/x-executable' }] },
  { assets: [{ ...request().assets[0]!, data: 'YR==' }] },
  { title: 'x'.repeat(2049) },
])('refuses invalid complete publication input before blob capture', async (patch) => {
  const h = await harness()
  await expect(
    h.ctx.artifacts.publish(h.session, { ...request(), ...patch } as ArtifactPublish),
  ).rejects.toThrow()
  expect(h.saves()).toBe(0)
})
it('includes all decoded assets in the publication byte cap', async () => {
  const h = await harness({ config: Object.assign({}, config, { maxPublicationBytes: 4200 }) })
  const input = request('x'.repeat(4000))
  await expect(
    h.ctx.artifacts.publish(h.session, {
      ...input,
      assets: [
        ...input.assets,
        { name: 'extra.txt', mediaType: 'text/plain', data: Buffer.from('x'.repeat(300)).toString('base64') },
      ],
    }),
  ).rejects.toThrow('publication')
  expect(h.saves()).toBe(0)
})

it('refuses catalogue and content calls before the provider initialization owns a ledger', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('workspaceRegistry', { get: (id: string) => ({ id }) } as never)
  const provider = new DurableArtifacts(ctx, config)
  await expect(provider.list('workspace' as never, null)).rejects.toThrow('not active')
  await expect(
    provider.read('workspace' as never, randomUUID() as never, randomUUID() as never, 'index.html'),
  ).rejects.toThrow('not active')
})
it('retains unrelated Session events when finding exact durable publication evidence', async () => {
  const h = await harness()
  h.session.append('turn/start', { turn: 1 })
  const first = await h.ctx.artifacts.publish(h.session, { ...request(), profile: 'document' })
  expect(first.capabilities).toEqual(['published-assets'])
  await h.ctx.fiber.dispose()
  const cold = await harness(h)
  expect((await cold.ctx.artifacts.list(h.workspaceId, null)).items[0]?.head).toEqual(first)
})

it('refuses unknown Workspace inventory and preserves explicitly cancellable successful reads', async () => {
  const h = await harness()
  await expect(h.ctx.artifacts.list('absent' as WorkspaceId, null)).rejects.toThrow('Unknown')
  const value = await h.ctx.artifacts.publish(h.session, request())
  const controller = new AbortController()
  expect(
    await h.ctx.artifacts.read(
      h.workspaceId,
      value.artifactId,
      value.revisionId,
      value.entry,
      controller.signal,
    ),
  ).toMatchObject({ revision: value })
})
it('rejects a complete receipt that exceeds metadata admission after bounded capture', async () => {
  const h = await harness({ config: Object.assign({}, config, { maxMetadataBytes: 650 }) })
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow('Complete artifact receipt')
  expect(h.saves()).toBe(1)
  expect((await h.ctx.artifacts.list(h.workspaceId, null)).items).toEqual([])
})
it.each(['capture', 'checkpoint'] as const)(
  'refuses publication moved to another Workspace during %s',
  async (stage) => {
    const h = await harness()
    const move = () => {
      h.workspaces[0]!.sessionIds = []
      h.workspaces[1]!.sessionIds.push(h.session.id)
    }
    if (stage === 'capture') {
      const save = h.ctx.attachments.saveFile.bind(h.ctx.attachments)
      h.ctx.attachments.saveFile = async (input) => {
        const value = await save(input)
        move()
        return value
      }
    } else
      h.ctx.on('session/flush', (live) => {
        if (live.snapshotEvents().some(event => event.type === 'artifact/published')) move()
      })
    await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow(
      stage === 'capture' ? 'during publication' : 'before catalogue acknowledgement',
    )
    expect((await h.ctx.artifacts.list(h.workspaceId, null)).items).toEqual([])
  },
)
it('rejects a conflicting live publication inserted before its durable receipt is acknowledged', async () => {
  const h = await harness()
  const read = h.ctx.attachments.readFileStream.bind(h.ctx.attachments)
  h.ctx.attachments.readFileStream = async function* (ref, signal) {
    const receipt = (storedLedger(h.pool).global as Ledger).operations[0]!
    if (receipt.revision !== null)
      h.session.append('artifact/published', { revision: { ...receipt.revision, title: 'Conflict' } })
    yield* read(ref, signal)
  }
  await expect(h.ctx.artifacts.publish(h.session, request())).rejects.toThrow(
    'conflicts with its durable receipt',
  )
  expect((await h.ctx.artifacts.list(h.workspaceId, null)).items).toEqual([])
})
it('retains an uncommitted receipt without a publication event at startup', async () => {
  const h = await harness()
  const input = request()
  h.failSecondFlush()
  await expect(h.ctx.artifacts.publish(h.session, input)).rejects.toThrow('checkpoint')
  h.durable.set(
    h.session.id,
    h.durable.get(h.session.id)!.filter(event => event.type !== 'artifact/published'),
  )
  await h.ctx.fiber.dispose()
  const next = await harness(h)
  expect(await next.ctx.artifacts.pending(h.workspaceId)).toHaveLength(1)
  expect((await next.ctx.artifacts.list(h.workspaceId, null)).items).toEqual([])
})
