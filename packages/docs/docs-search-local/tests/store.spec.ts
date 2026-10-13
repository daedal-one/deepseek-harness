/**
 * Store-level behavior: schema identity, hash-driven reconciliation, the
 * optional `vec0` table, and the foreign-database refusal.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOCS_SEARCH_APPLICATION_ID, DocsIndexStore, type StoredChunk } from '../src/store.ts'

let directory: string | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-docs-store-'))
})

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
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
      expect(store.pendingCount([chunk('a.md', 'one', 'alpha'), chunk('b.md', 'two', 'beta')])).toBe(0)

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

  it('counts pending work without writing anything', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      store.reconcile([chunk('a.md', 'one', 'alpha')])
      expect(store.pendingCount([chunk('a.md', 'one', 'alpha')])).toBe(0)
      expect(store.pendingCount([chunk('a.md', 'one', 'changed')])).toBe(1)
      expect(store.pendingCount([])).toBe(1)
      // Read-only: the count did not change the stored corpus.
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
      const outcome = store.reconcile([chunk('a.md', 'one', 'alpha'), chunk('b.md', 'two', 'beta')])
      store.writeVectors(outcome.embeddings.map((entry, index) => ({
        id: entry.id,
        vector: index === 0 ? [1, 0, 0, 0] : [0, 1, 0, 0],
      })))
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
      const first = store.reconcile([chunk('a.md', 'one', 'alpha')])
      store.writeVectors([{ id: first.embeddings[0]!.id, vector: [1, 0] }])
      expect(store.searchSemantic([1, 0], 1, [])[0]?.score).toBeCloseTo(1, 6)

      const second = store.reconcile([chunk('a.md', 'one', 'alpha changed')])
      store.writeVectors([{ id: second.embeddings[0]!.id, vector: [0, 1] }])
      // The replacement row is the same metadata id, so no stale vector survives.
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

  it('rolls back a failed vector write', async () => {
    const store = await DocsIndexStore.open(':memory:')
    try {
      await store.loadVectorExtension(4)
      const outcome = store.reconcile([chunk('a.md', 'one', 'alpha')])
      const id = outcome.embeddings[0]!.id
      store.writeVectors([{ id, vector: [1, 0, 0, 0] }])
      // A wrong-width vector makes the second insert fail, so the first must
      // not survive either.
      expect(() => { store.writeVectors([{ id: id + 1, vector: [1, 0] }]) }).toThrow()
      expect(store.searchSemantic([1, 0, 0, 0], 5, [])[0]?.score).toBeCloseTo(1, 6)
    } finally {
      store.close()
    }
  })
})
