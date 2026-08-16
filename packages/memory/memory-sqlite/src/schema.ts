import { DatabaseSync } from 'node:sqlite'

/** Current durable memory schema. There are no in-place migrations before release. */
export const SCHEMA_VERSION = 1
/** SQLite application identity for memory databases. */
export const MEMORY_SQLITE_APPLICATION_ID = 0x4453484d

/**
 * Open, identify, and initialize one memory database or fail closed.
 * @param path - absolute SQLite database path.
 * @returns the configured application-owned database handle.
 */
export function openMemoryDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE')
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").get() as { count: number }
    if (version === 0 && (applicationId !== 0 || count > 0)) throw new Error(`memory database at "${path}" has an unversioned schema or application identity`)
    if (version !== 0 && version !== SCHEMA_VERSION) throw new Error(`memory database at "${path}" has schema version ${version}, incompatible with this build (${SCHEMA_VERSION})`)
    if (version === SCHEMA_VERSION && applicationId !== MEMORY_SQLITE_APPLICATION_ID) throw new Error(`memory database at "${path}" has application id ${applicationId}, expected ${MEMORY_SQLITE_APPLICATION_ID}`)
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision > 0),
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'global')),
        project TEXT,
        statement TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'challenged', 'rejected', 'superseded')),
        evidence_json TEXT NOT NULL,
        trust_json TEXT NOT NULL,
        validity_json TEXT NOT NULL,
        contradicts_json TEXT NOT NULL,
        challenge_json TEXT,
        superseded_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL CHECK (access_count >= 0),
        CHECK ((scope_kind = 'global' AND project IS NULL) OR (scope_kind = 'project' AND project IS NOT NULL))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS memories_scope_status_updated ON memories(scope_kind, project, status, updated_at DESC);
    `)
    if (version === 0) {
      db.exec(`PRAGMA application_id = ${MEMORY_SQLITE_APPLICATION_ID}; PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    db.exec('COMMIT; PRAGMA journal_mode = WAL')
    return db
  } catch (error: unknown) {
    try { db.exec('ROLLBACK') } catch { /* The original schema failure remains actionable. */ }
    db.close()
    throw error
  }
}
