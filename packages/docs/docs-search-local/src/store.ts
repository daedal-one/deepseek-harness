/**
 * SQLite store for the docs-search index: a `vec0` vector table, an FTS5
 * lexical table, and one metadata table joining them by chunk id.
 *
 * `node:sqlite` is imported lazily so a composition that never searches never
 * loads the module, and the `sqlite-vec` extension is loaded separately so a
 * host without the extension loses only the semantic arm.
 * @module @deepseek-ai/dsh-docs-search-local/store
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DocsSourceKind } from '@deepseek-ai/dsh-docs-search'

/** Application identity protecting unrelated databases from a derived reset. */
export const DOCS_SEARCH_APPLICATION_ID = 0x44534453

/** Index schema version; a different stamped version resets the derived index in place. */
export const DOCS_SEARCH_SCHEMA_VERSION = 1

/** One stored chunk as the index carries it. */
export interface StoredChunk {
  /** Corpus kind the chunk was extracted from. */
  kind: DocsSourceKind
  /** Repository-relative owning file. */
  file: string
  /** Section anchor inside the file. */
  anchor: string
  /** Stored section title. */
  title: string
  /** Embedded body text. */
  body: string
  /** SHA-256 hex digest used to detect a changed chunk. */
  hash: string
}

/** One lexical or semantic hit before fusion. */
export interface ChunkHit {
  /** Metadata row id; the key the metadata, FTS5, and vector tables share. */
  id: number
  /** Provider-native arm score. */
  score: number
}

/** Metadata projection joined onto a fused result. */
export interface ChunkMetadata {
  /** Metadata row id. */
  id: number
  /** Corpus kind. */
  kind: DocsSourceKind
  /** Repository-relative owning file. */
  file: string
  /** Section anchor inside the file. */
  anchor: string
  /** Stored section title. */
  title: string
  /** Stored body text, used to build a bounded snippet. */
  body: string
}

/** Result of reconciling the stored index against one corpus scan. */
export interface ReconcileOutcome {
  /** Number of chunks inserted or replaced because their hash differed. */
  changed: number
  /** Number of chunks deleted because they vanished from the corpus. */
  removed: number
  /** Row id and body of every chunk this build must embed, in corpus order. */
  embeddings: Array<{ id: number; chunk: StoredChunk }>
}

/**
 * The documentation index store. One instance owns one SQLite handle; the
 * provider serializes every call against it.
 */
export class DocsIndexStore {
  private constructor(
    private readonly db: DatabaseSync,
    private vecLoaded: boolean,
  ) {}

  /**
   * Open or create the index database and ensure its schema.
   *
   * Missing directories and files are created owner-only. A database belonging
   * to another application, or carrying an unrecognized user table, is refused
   * rather than reset; a recognized index from another schema version is
   * dropped in place, because it is a derived artifact.
   * @param path - index database path, or `:memory:` for an ephemeral index.
   * @returns the open store with its metadata and lexical schema ensured.
   */
  static async open(path: string): Promise<DocsIndexStore> {
    const actual = path === ':memory:' ? path : resolve(path)
    if (actual !== ':memory:') {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
      await createDatabaseFile(actual)
    }
    const { DatabaseSync: Database } = await import('node:sqlite')
    const db = new Database(actual, { allowExtension: true })
    try {
      await assertDatabaseIdentity(db, actual)
      // The validated journal-mode union is not caller-controlled SQL.
      db.exec('PRAGMA journal_mode = WAL')
      ensureSchema(db)
      return new DocsIndexStore(db, false)
    } catch (error: unknown) {
      db.close()
      throw error
    }
  }

  /** Close the underlying handle. Idempotent. */
  close(): void {
    this.db.close()
  }

  /**
   * Load the `sqlite-vec` extension into this connection and declare the
   * `vec0` table.
   *
   * The table is declared here rather than with the metadata tables because
   * `vec0` exists only once the extension is loaded; declaring it earlier would
   * silently leave a store without a vector table. Loading twice is a no-op. A
   * failure is the caller's to record as a semantic-arm degradation, and the
   * handle stays usable for lexical search.
   * @param dimensions - embedding width the `vec0` table is declared with.
   * @param modelIdentity - model and preprocessing identity used to invalidate incompatible vectors.
   * @returns the failure reason, or `undefined` when the extension is loaded.
   */
  async loadVectorExtension(dimensions: number, modelIdentity = String(dimensions)): Promise<string | undefined> {
    if (this.vecLoaded) return undefined
    try {
      const { load } = await import('sqlite-vec')
      load(this.db)
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const prior = this.db.prepare('SELECT identity FROM doc_embedding_config').get() as { identity: string } | undefined
        if (prior?.identity !== modelIdentity) {
          this.db.exec('DROP TABLE IF EXISTS doc_chunks_vec; DELETE FROM doc_embedding_config')
          this.db.prepare('INSERT INTO doc_embedding_config (identity) VALUES (?)').run(modelIdentity)
        }
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_vec USING vec0(embedding float[${dimensions}])`)
        this.db.exec('COMMIT')
      } catch (error: unknown) {
        this.db.exec('ROLLBACK')
        throw error
      }
      this.vecLoaded = true
      return undefined
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  /** Whether the vector extension is loaded on this connection. */
  get vectorReady(): boolean {
    return this.vecLoaded
  }

  /**
   * Reconcile the stored index against one scanned corpus.
   *
   * Chunks whose hash is unchanged keep their row, their embedding, and their
   * lexical entry, which is what makes a repeated build embed nothing. A
   * changed chunk replaces its row and drops both index entries; a chunk absent
   * from the scan is deleted. The whole reconciliation runs in one transaction,
   * so a failure leaves the previous index intact.
   * @param chunks - the complete scanned corpus, keyed by file and anchor.
   * @param vectors - staged embeddings keyed by the input chunk; committed with metadata and lexical entries.
   * @returns changed and removed counts plus the replaced row ids.
   */
  reconcile(chunks: readonly StoredChunk[], vectors: ReadonlyMap<StoredChunk, readonly number[]> = new Map()): ReconcileOutcome {
    const existing = new Map<string, { id: number; hash: string }>()
    for (const row of this.db.prepare('SELECT id, file, anchor, hash FROM doc_chunks').all() as unknown as Array<{ id: number; file: string; anchor: string; hash: string }>) {
      existing.set(`${row.file}\u0000${row.anchor}`, { id: row.id, hash: row.hash })
    }
    const insert = this.db.prepare(
      'INSERT INTO doc_chunks (file, anchor, title, kind, hash, body) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const outcome: ReconcileOutcome = { changed: 0, removed: 0, embeddings: [] }
    const seen = new Set<string>()
    let began = false
    try {
      this.db.exec('BEGIN IMMEDIATE')
      began = true
      for (const chunk of chunks) {
        const key = `${chunk.file}\u0000${chunk.anchor}`
        seen.add(key)
        const prior = existing.get(key)
        if (prior !== undefined && prior.hash === chunk.hash) {
          const vector = vectors.get(chunk)
          if (vector !== undefined) this.writeVector(prior.id, vector)
          continue
        }
        if (prior !== undefined) this.deleteChunk(prior.id)
        const result = insert.run(chunk.file, chunk.anchor, chunk.title, chunk.kind, chunk.hash, chunk.body)
        const id = Number(result.lastInsertRowid)
        this.indexChunk(id, chunk)
        const vector = vectors.get(chunk)
        if (vector !== undefined) this.writeVector(id, vector)
        outcome.changed += 1
        outcome.embeddings.push({ id, chunk })
      }
      for (const [key, prior] of existing) {
        if (seen.has(key)) continue
        this.deleteChunk(prior.id)
        outcome.removed += 1
      }
      if (this.vecLoaded) this.db.exec('DELETE FROM doc_chunks_vec WHERE rowid NOT IN (SELECT id FROM doc_chunks)')
      this.db.exec('COMMIT')
      return outcome
    } catch (error: unknown) {
      if (began) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          // The original reconciliation failure remains the actionable cause.
        }
      }
      throw error
    }
  }

  /** Insert a staged vector inside the caller's reconciliation transaction. */
  private writeVector(id: number, vector: readonly number[]): void {
    this.db.prepare('DELETE FROM doc_chunks_vec WHERE rowid = ?').run(BigInt(id))
    this.db.prepare('INSERT INTO doc_chunks_vec (rowid, embedding) VALUES (?, ?)').run(BigInt(id), JSON.stringify(vector))
  }

  /**
   * Rank stored chunks lexically with BM25 over the FTS5 table.
   * @param expression - already-sanitized FTS5 match expression.
   * @param limit - maximum hits to return.
   * @param kinds - corpus kinds to keep, or an empty list for every kind.
   * @returns hits ordered by ascending BM25 rank, which is descending relevance.
   */
  searchLexical(expression: string, limit: number, kinds: readonly DocsSourceKind[]): ChunkHit[] {
    if (expression.length === 0) return []
    const rows = this.db.prepare(`
      SELECT doc_chunks_fts.rowid AS id, bm25(doc_chunks_fts) AS score
      FROM doc_chunks_fts
      JOIN doc_chunks AS m ON m.id = doc_chunks_fts.rowid
      WHERE doc_chunks_fts MATCH ?
      ${kinds.length === 0 ? '' : `AND m.kind IN (${kinds.map(() => '?').join(', ')})`}
      ORDER BY score ASC, id ASC
      LIMIT ?
    `).all(expression, ...kinds, limit) as unknown as ChunkHit[]
    return rows
  }

  /**
   * Rank stored chunks by cosine similarity through the `vec0` KNN index.
   *
   * Embeddings are L2-normalized, so the `vec0` L2 distance orders vectors
   * exactly as their dot product does; the returned score is that dot product.
   * @param vector - normalized query embedding.
   * @param limit - maximum hits to return.
   * @param kinds - corpus kinds to keep, or an empty list for every kind.
   * @returns hits ordered by descending similarity.
   */
  searchSemantic(vector: readonly number[], limit: number, kinds: readonly DocsSourceKind[]): ChunkHit[] {
    if (!this.vecLoaded) return []
    const rows = this.db.prepare(`
      SELECT v.rowid AS id, v.distance AS distance
      FROM doc_chunks_vec AS v
      JOIN doc_chunks AS m ON m.id = v.rowid
      WHERE v.embedding MATCH ? AND k = ?
      ${kinds.length === 0 ? '' : `AND m.kind IN (${kinds.map(() => '?').join(', ')})`}
      ORDER BY v.distance ASC
    `).all(JSON.stringify(vector), limit, ...kinds) as unknown as Array<{ id: number; distance: number }>
    return rows.map(row => ({ id: row.id, score: 1 - row.distance ** 2 / 2 }))
  }

  /**
   * Read the metadata projection for a set of chunk ids.
   * @param ids - metadata row ids to read; an empty list reads nothing.
   * @returns one entry per stored id, in ascending id order.
   */
  metadata(ids: readonly number[]): ChunkMetadata[] {
    if (ids.length === 0) return []
    const statement: StatementSync = this.db.prepare(`
      SELECT id, kind, file, anchor, title, body
      FROM doc_chunks
      WHERE id IN (${ids.map(() => '?').join(', ')})
      ORDER BY id ASC
    `)
    return (statement.all(...ids) as unknown as Array<Omit<ChunkMetadata, 'kind'> & { kind: string }>).map(row => ({
      id: row.id,
      kind: row.kind as DocsSourceKind,
      file: row.file,
      anchor: row.anchor,
      title: row.title,
      body: row.body,
    }))
  }

  /**
   * Count stored chunks.
   * @returns number of metadata rows in the index.
   */
  chunkCount(): number {
    const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM doc_chunks').get() as { count: number }
    return count
  }

  /**
   * Count corpus files whose complete current content is stored.
   *
   * A file counts only when it owns at least one stored chunk; a file whose
   * sections all vanished is deleted by the same reconciliation that produced
   * the count.
   * @returns number of distinct owner files in the index.
   */
  indexedFileCount(): number {
    const { count } = this.db.prepare('SELECT COUNT(DISTINCT file) AS count FROM doc_chunks').get() as { count: number }
    return count
  }

  /**
   * Find chunks whose embedding is absent or no longer matches their content.
   * @param chunks - the complete scanned corpus.
   * @returns new, changed, and missing-vector chunks in corpus order.
   */
  pendingEmbeddings(chunks: readonly StoredChunk[]): StoredChunk[] {
    const existing = new Map<string, string>()
    const rows = this.db.prepare(`
      SELECT m.file, m.anchor, m.hash FROM doc_chunks AS m
      JOIN doc_chunks_vec AS v ON v.rowid = m.id
    `).all() as unknown as Array<{ file: string; anchor: string; hash: string }>
    for (const row of rows) existing.set(`${row.file}\u0000${row.anchor}`, row.hash)
    return chunks.filter(chunk => existing.get(`${chunk.file}\u0000${chunk.anchor}`) !== chunk.hash)
  }

  private indexChunk(id: number, chunk: StoredChunk): void {
    this.db.prepare('DELETE FROM doc_chunks_fts WHERE rowid = ?').run(id)
    this.unindexVector(id)
    this.db.prepare('INSERT INTO doc_chunks_fts (rowid, title, body) VALUES (?, ?, ?)').run(id, chunk.title, chunk.body)
  }

  private deleteChunk(id: number): void {
    this.db.prepare('DELETE FROM doc_chunks_fts WHERE rowid = ?').run(id)
    this.unindexVector(id)
    this.db.prepare('DELETE FROM doc_chunks WHERE id = ?').run(id)
  }

  /**
   * Drop one chunk's vector when the vector table exists.
   *
   * The `vec0` table is absent on a connection that never loaded the
   * extension, and lexical indexing must keep working there.
   * @param id - metadata row id whose vector is removed.
   */
  private unindexVector(id: number): void {
    if (!this.vecLoaded) return
    this.db.prepare('DELETE FROM doc_chunks_vec WHERE rowid = ?').run(BigInt(id))
  }
}

/** Exclusively create a missing database file with owner-only permissions. */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Refuse a foreign database and reset a recognized one from another schema version. */
async function assertDatabaseIdentity(db: DatabaseSync, path: string): Promise<void> {
  const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all() as Array<{ name: string }>
  if (applicationId !== 0 && applicationId !== DOCS_SEARCH_APPLICATION_ID) {
    throw new Error(`docs-search database at "${path}" belongs to another application`)
  }
  if (applicationId === 0 && tables.length > 0) {
    throw new Error(`docs-search database at "${path}" is not an empty or recognized derived index`)
  }
  if (applicationId === DOCS_SEARCH_APPLICATION_ID && version !== DOCS_SEARCH_SCHEMA_VERSION) {
    if (tables.some(table => table.name === 'doc_chunks_vec')) {
      const { load } = await import('sqlite-vec')
      load(db)
    }
    for (const table of tables) db.exec(`DROP TABLE IF EXISTS "${table.name.replaceAll('"', '""')}"`)
    db.exec('PRAGMA user_version = 0')
  }
}

/** Create the metadata and lexical tables. */
function ensureSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA application_id = ${DOCS_SEARCH_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      file   TEXT NOT NULL,
      anchor TEXT NOT NULL,
      title  TEXT NOT NULL,
      kind   TEXT NOT NULL,
      hash   TEXT NOT NULL,
      body   TEXT NOT NULL,
      UNIQUE (file, anchor)
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
      title,
      body,
      tokenize = 'unicode61'
    )
  `)
  db.exec('CREATE TABLE IF NOT EXISTS doc_embedding_config (identity TEXT NOT NULL) STRICT')
  // The vector table is declared by `loadVectorExtension`, which runs only
  // once sqlite-vec is loaded; a store without the extension keeps its
  // metadata and FTS5 tables and reports the semantic arm as degraded.
  db.exec(`PRAGMA user_version = ${DOCS_SEARCH_SCHEMA_VERSION}`)
}
