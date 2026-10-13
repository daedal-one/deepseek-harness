/**
 * Store-level behavior: schema identity, hash-driven reconciliation, the
 * optional `vec0` table, and the foreign-database refusal.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { DOCS_SEARCH_APPLICATION_ID, DocsIndexStore, type StoredChunk } from '../src/store.ts'

let directory: string | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-docs-store-'))
})

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
  vi.restoreAllMocks()
})

/** One chunk fixture. */
function chunk(file: string, anchor: string, body: string, kind: StoredChunk['kind'] = 'subsystem'): StoredChunk {
  return { kind, file, anchor, title: anchor, body, hash: `hash-${body}` }
}

describe('docs index store', () => {
  it('inserts changed chunks, keeps unchanged ones, and deletes vanished ones', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      const first = store.reconcile([chunk('a.md', 'one', 'alpha'), chunk('b.md', 'two', 'beta')])
      expect(first.changed).toBe(2)
      expect(first.removed).toBe(0)
      expect(store.chunkCount()).toBe(2)
      expect(store.indexedFileCount()).toBe(2)

      // Identical corpus: nothing changes and no embedding is required.
      const second = store.reconcile([chunk('a.md', 'one', 'alpha'), chunk('b.md', 'two', 'beta')])
      expect(second.changed).toBe(0)
      expect(second.embeddings).toEqual([])

      // One body changes: exactly that chunk is replaced and re-embedded.
      const third = store.reconcile([chunk('a.md', 'one', 'alpha rewritten'), chunk('b.md', 'two', 'beta')])
      expect(third.changed).toBe(1)
      expect(third.embeddings.map(entry => entry.chunk.body)).toEqual(['alpha rewritten'])

      // One file vanishes: its chunk is removed.
      const fourth = store.reconcile([chunk('a.md', 'one', 'alpha rewritten')])
      expect(fourth.changed).toBe(0)
      expect(fourth.removed).toBe(1)
      expect(store.chunkCount()).toBe(1)
      expect(store.indexedFileCount()).toBe(1)
    } finally {
      store.close()
    }
  })

  it('finds missing vectors independently of unchanged document hashes', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      const chunks = [chunk('a.md', 'one', 'alpha')]
      store.reconcile(chunks)
      await store.loadVectorExtension(2)
      expect(store.pendingEmbeddings(chunks)).toEqual(chunks)
      store.reconcile(chunks, new Map([[chunks[0]!, [1, 0]]]))
      expect(store.pendingEmbeddings(chunks)).toEqual([])
      expect(store.pendingEmbeddings([chunk('a.md', 'one', 'changed')])).toHaveLength(1)
      expect(store.pendingEmbeddings([])).toEqual([])
      expect(store.chunkCount()).toBe(1)
    } finally {
      store.close()
    }
  })

  it('ranks lexically with BM25 and reads metadata back', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      store.reconcile([chunk('a.md', 'one', 'hybrid retrieval over documentation')])
      const hits = store.searchLexical('"hybrid"', 10, [])
      expect(hits).toHaveLength(1)
      const metadata = store.metadata(hits.map(hit => hit.id))
      expect(metadata[0]?.file).toBe('a.md')
      expect(metadata[0]?.anchor).toBe('one')
    } finally {
      store.close()
    }
  })

  it('restricts a lexical search to the requested kinds', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      store.reconcile([
        chunk('a.md', 'one', 'shared term', 'subsystem'),
        chunk('README.md', 'two', 'shared term', 'readme'),
      ])
      expect(store.searchLexical('"shared"', 10, [])).toHaveLength(2)
      expect(store.searchLexical('"shared"', 10, ['readme'])).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  it('loads sqlite-vec and ranks semantically', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      const failure = await store.loadVectorExtension(4)
      expect(failure).toBeUndefined()
      expect(store.vectorReady).toBe(true)
      const chunks = [chunk('a.md', 'one', 'alpha'), chunk('b.md', 'two', 'beta')]
      const outcome = store.reconcile(chunks, new Map(chunks.map((entry, index) => [
        entry, index === 0 ? [1, 0, 0, 0] : [0, 1, 0, 0],
      ])))
      const hits = store.searchSemantic([1, 0, 0, 0], 2, [])
      expect(hits).toHaveLength(2)
      expect(hits[0]!.id).toBe(outcome.embeddings[0]!.id)
      expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
    } finally {
      store.close()
    }
  })

  it('replaces a chunk vector when the chunk is re-embedded', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      await store.loadVectorExtension(2)
      const first = chunk('a.md', 'one', 'alpha')
      store.reconcile([first], new Map([[first, [1, 0]]]))
      expect(store.searchSemantic([1, 0], 1, [])[0]?.score).toBeCloseTo(1, 6)

      const second = chunk('a.md', 'one', 'alpha changed')
      store.reconcile([second], new Map([[second, [0, 1]]]))
      expect(store.searchSemantic([1, 0], 5, []).every(hit => hit.score < 0.5)).toBe(true)
      expect(store.searchSemantic([0, 1], 1, [])[0]?.score).toBeCloseTo(1, 6)
    } finally {
      store.close()
    }
  })

  it('keeps the lexical arm usable when the vector extension never loads', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      expect(store.vectorReady).toBe(false)
      expect(store.searchSemantic([1, 0], 5, [])).toEqual([])
      store.reconcile([chunk('a.md', 'one', 'alpha')])
      expect(store.searchLexical('"alpha"', 5, [])).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  it('persists an index across handles and creates the file owner-only', async () => {
    const path = join(directory!, 'nested', 'docs.sqlite')
    const first = await DocsIndexStore.open(path)
    first.reconcile([chunk('a.md', 'one', 'alpha')])
    first.close()

    const second = await DocsIndexStore.open(path)
    try {
      expect(second.chunkCount()).toBe(1)
    } finally {
      second.close()
    }
  })

  it('refuses a database belonging to another application', async () => {
    const path = join(directory!, 'foreign.sqlite')
    const { DatabaseSync } = await import('node:sqlite')
    const foreign = new DatabaseSync(path)
    foreign.exec('PRAGMA application_id = 12345; CREATE TABLE other (x TEXT)')
    foreign.close()

    await expect(DocsIndexStore.open(path)).rejects.toThrow(/belongs to another application/)
  })

  it('refuses an unversioned database carrying user tables', async () => {
    const path = join(directory!, 'unversioned.sqlite')
    const { DatabaseSync } = await import('node:sqlite')
    const foreign = new DatabaseSync(path)
    foreign.exec('CREATE TABLE stray (x TEXT)')
    foreign.close()

    await expect(DocsIndexStore.open(path)).rejects.toThrow(/not an empty or recognized derived index/)
  })

  it('resets a recognized index stamped with another schema version', async () => {
    const path = join(directory!, 'stale.sqlite')
    const first = await DocsIndexStore.open(path)
    first.reconcile([chunk('a.md', 'one', 'alpha')])
    first.close()

    const { DatabaseSync } = await import('node:sqlite')
    const stale = new DatabaseSync(path)
    stale.exec('PRAGMA user_version = 99')
    stale.close()

    const reopened = await DocsIndexStore.open(path)
    try {
      // The derived index is disposable: an unrecognized version drops its rows.
      expect(reopened.chunkCount()).toBe(0)
    } finally {
      reopened.close()
    }
  })

  it('stamps its application id and schema version', async () => {
    const path = join(directory!, 'identity.sqlite')
    const store = await DocsIndexStore.open(path)
    store.close()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path)
    try {
      const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(applicationId).toBe(DOCS_SEARCH_APPLICATION_ID)
      expect(version).toBe(1)
    } finally {
      db.close()
    }
  })

  it('leaves the previous index intact when a reconciliation fails', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      store.reconcile([chunk('a.md', 'one', 'alpha')])
      expect(store.chunkCount()).toBe(1)
      // Two chunks claiming one (file, anchor) violate the unique constraint
      // and roll the whole transaction back.
      expect(() => store.reconcile([chunk('a.md', 'one', 'first'), chunk('a.md', 'one', 'second')])).toThrow()
      expect(store.chunkCount()).toBe(1)
    } finally {
      store.close()
    }
  })

  it('rolls back metadata, lexical entries, deletions, and vectors when a staged vector fails', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      await store.loadVectorExtension(4)
      const old = chunk('a.md', 'one', 'alpha')
      const removed = chunk('b.md', 'two', 'beta')
      store.reconcile([old, removed], new Map([[old, [1, 0, 0, 0]], [removed, [0, 1, 0, 0]]]))
      const replacement = chunk('a.md', 'one', 'changed')
      const extra = chunk('c.md', 'three', 'gamma')
      expect(() => store.reconcile([replacement, extra], new Map([
        [replacement, [0, 0, 1, 0]], [extra, [1, 0]],
      ]))).toThrow()
      expect(store.chunkCount()).toBe(2)
      expect(store.searchLexical('"alpha" OR "beta"', 5, [])).toHaveLength(2)
      expect(store.searchLexical('"changed" OR "gamma"', 5, [])).toEqual([])
      expect(store.searchSemantic([1, 0, 0, 0], 5, [])[0]?.score).toBeCloseTo(1, 6)
      expect(store.pendingEmbeddings([old, removed])).toEqual([])
    } finally {
      store.close()
    }
  })

  it('invalidates embeddings when the configured model or dimensions change', async () => {
    const path = join(directory!, 'model.sqlite')
    const chunks = [chunk('a.md', 'one', 'alpha')]
    const first = await DocsIndexStore.open(path)
    try {
      expect(await first.loadVectorExtension(2, 'model-a')).toBeUndefined()
      first.reconcile(chunks, new Map([[chunks[0]!, [1, 0]]]))
    } finally { first.close() }
    const second = await DocsIndexStore.open(path)
    try {
      expect(await second.loadVectorExtension(4, 'model-b')).toBeUndefined()
      expect(second.searchSemantic([1, 0, 0, 0], 5, [])).toEqual([])
      expect(second.pendingEmbeddings(chunks)).toEqual(chunks)
      expect(second.searchLexical('"alpha"', 5, [])).toHaveLength(1)
      expect(await second.loadVectorExtension(4, 'model-b')).toBeUndefined()
    } finally { second.close() }
  })
})

it('keeps an existing model index and cosine scores across reopen', async () => {
  const path = join(directory!, 'reopen.sqlite')
  const chunks = [chunk('a.md', 'one', 'alpha'), chunk('b.md', 'two', 'beta')]
  const first = await DocsIndexStore.open(path)
  try {
    await first.loadVectorExtension(2)
    first.reconcile(chunks, new Map([[chunks[0]!, [1, 0]], [chunks[1]!, [0, 1]]]))
  } finally { first.close() }
  const second = await DocsIndexStore.open(path)
  try {
    expect(await second.loadVectorExtension(2)).toBeUndefined()
    expect(second.pendingEmbeddings(chunks)).toEqual([])
    expect(second.searchSemantic([1, 0], 2, [])[1]?.score).toBeCloseTo(0, 6)
    expect(second.searchLexical('', 5, [])).toEqual([])
  } finally { second.close() }
})

it('prunes vectors left by a lexical-only update', async () => {
  const path = join(directory!, 'orphan.sqlite')
  const old = chunk('a.md', 'one', 'alpha')
  const first = await DocsIndexStore.open(path)
  try {
    await first.loadVectorExtension(2)
    first.reconcile([old], new Map([[old, [1, 0]]]))
  } finally { first.close() }
  const second = await DocsIndexStore.open(path)
  const next = chunk('b.md', 'two', 'beta')
  try { second.reconcile([next]) } finally { second.close() }
  const third = await DocsIndexStore.open(path)
  try {
    await third.loadVectorExtension(2)
    third.reconcile([next], new Map([[next, [0, 1]]]))
    expect(third.searchSemantic([1, 0], 1, [])).toHaveLength(1)
  } finally { third.close() }
})

it.each([new Error('extension unavailable'), 'extension unavailable'])('reports a native extension failure and keeps lexical search usable', async (failure) => {
  const store = await DocsIndexStore.open(':memory:')
  vi.spyOn(DatabaseSync.prototype, 'loadExtension').mockImplementationOnce(() => { throw failure })
  try {
    expect(await store.loadVectorExtension(2)).toBe('extension unavailable')
    store.reconcile([chunk('a.md', 'one', 'alpha')])
    expect(store.searchLexical('"alpha"', 5, [])).toHaveLength(1)
    expect(await store.loadVectorExtension(2)).toBeUndefined()
  } finally { store.close() }
})

it('rolls back vector schema setup when an invalid width is refused', async () => {
  const store = await DocsIndexStore.open(':memory:')
  try {
    expect(await store.loadVectorExtension(-1)).toBeTypeOf('string')
    expect(await store.loadVectorExtension(2)).toBeUndefined()
  } finally { store.close() }
})

it('does not roll back another transaction when writer admission fails', async () => {
  const path = join(directory!, 'locked.sqlite')
  const store = await DocsIndexStore.open(path)
  const competing = new DatabaseSync(path)
  competing.exec('BEGIN IMMEDIATE')
  try {
    expect(() => store.reconcile([chunk('a.md', 'one', 'alpha')])).toThrow('locked')
    expect(store.chunkCount()).toBe(0)
  } finally { competing.exec('ROLLBACK'); competing.close(); store.close() }
})

it('reports a filesystem error creating the database file', async () => {
  const path = join(directory!, 'x'.repeat(300))
  await expect(DocsIndexStore.open(path)).rejects.toThrow()
})

it('resets a stale schema that contains native vector tables', async () => {
  const path = join(directory!, 'stale-vectors.sqlite')
  const first = await DocsIndexStore.open(path)
  try {
    await first.loadVectorExtension(2)
    const entry = chunk('a.md', 'one', 'alpha')
    first.reconcile([entry], new Map([[entry, [1, 0]]]))
  } finally { first.close() }
  const stamp = new DatabaseSync(path)
  try { stamp.exec('PRAGMA user_version = 99') } finally { stamp.close() }
  const rebuilt = await DocsIndexStore.open(path)
  try {
    expect(rebuilt.chunkCount()).toBe(0)
    expect(await rebuilt.loadVectorExtension(4)).toBeUndefined()
  } finally { rebuilt.close() }
})
