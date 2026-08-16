import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import MemoryRuntime from '@deepseek-ai/dsh-memory'
import * as SqlitePlugin from '../src/index.ts'

const { SqliteMemoryProvider, openMemoryDatabase, SCHEMA_VERSION } = SqlitePlugin

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function database() { const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-')); dirs.push(dir); const db = openMemoryDatabase(join(dir, 'memory.db')); return { db, provider: new SqliteMemoryProvider(db, 10, 365) } }

describe('SqliteMemoryProvider', () => {
  it('supports review, scoped query, challenge, supersession, checkpoint, and delete', async () => {
    const { db, provider } = await database()
    try {
      const scope = { kind: 'project' as const, project: '/repo' }
      const proposed = await provider.propose({ scope, statement: 'Uses pnpm', evidence: [{ kind: 'file', ref: '/repo/package.json' }], trust: { score: 0.8, source: 'user' } })
      expect((await provider.query({ scope, text: 'pnpm', statuses: ['proposed'] })).memories).toHaveLength(1)
      const active = await provider.review({ ref: { scope, id: proposed.id, revision: proposed.revision }, decision: 'accept' })
      const challenged = await provider.challenge({ ref: { scope, id: active.id, revision: active.revision }, reason: 'workspace changed' })
      const result = await provider.supersede({ ref: { scope, id: challenged.id, revision: challenged.revision }, replacement: { scope, statement: 'Uses npm', evidence: [{ kind: 'file', ref: '/repo/package-lock.json' }], trust: { score: 0.9, source: 'reviewer' }, contradicts: [challenged.id] } })
      expect(result.previous.supersededBy).toBe(result.replacement.id)
      expect((await provider.get({ kind: 'global' }, result.replacement.id))).toBeUndefined()
      const [used] = await provider.checkpoint({ refs: [{ scope, id: result.replacement.id, revision: result.replacement.revision }] })
      expect(used?.accessCount).toBe(1)
      expect(used?.revision).toBe(2)
      if (used === undefined) throw new Error('checkpoint did not return the requested memory')
      await expect(provider.delete({ scope, id: used.id, revision: used.revision })).resolves.toBe(true)
    } finally { db.close() }
  })

  it('rejects stale revisions and foreign schema versions', async () => {
    const { db, provider } = await database()
    const scope = { kind: 'global' as const }
    const proposed = await provider.propose({ scope, statement: 'Fact', evidence: [], trust: { score: 1, source: 'reviewer' } })
    await provider.review({ ref: { scope, id: proposed.id, revision: 1 }, decision: 'accept' })
    await expect(provider.delete({ scope, id: proposed.id, revision: 1 })).rejects.toMatchObject({ code: 'MEMORY_REVISION_CONFLICT' })
    db.close()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-foreign-')); dirs.push(dir); const path = join(dir, 'foreign.db')
    const foreign = new DatabaseSync(path); foreign.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`); foreign.close()
    expect(() => openMemoryDatabase(path)).toThrow('incompatible with this build')
  })

  it('binds every mutation and contradiction to its declared scope', async () => {
    const { db, provider } = await database()
    try {
      const project = { kind: 'project' as const, project: '/repo' }
      const global = { kind: 'global' as const }
      const record = await provider.propose({ scope: project, statement: 'Project fact', evidence: [], trust: { score: 1, source: 'reviewer' } })
      await expect(provider.review({ ref: { scope: global, id: record.id, revision: record.revision }, decision: 'accept' })).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' })
      await expect(provider.checkpoint({ refs: [{ scope: global, id: record.id, revision: record.revision }] })).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' })
      const [checkpointed] = await provider.checkpoint({ refs: [{ scope: project, id: record.id, revision: record.revision }] })
      await expect(provider.review({ ref: { scope: project, id: record.id, revision: record.revision }, decision: 'accept' })).rejects.toMatchObject({ code: 'MEMORY_REVISION_CONFLICT' })
      expect(checkpointed?.revision).toBe(record.revision + 1)
      await expect(provider.propose({ scope: global, statement: 'Cross-scope claim', evidence: [], trust: { score: 1, source: 'reviewer' }, contradicts: [record.id] })).rejects.toMatchObject({ code: 'MEMORY_SCOPE_MISMATCH' })
    } finally { db.close() }
  })

  it('removes the provider before closing its database on disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-lifecycle-'))
    dirs.push(dir)
    const ctx = new Context()
    const runtime = await ctx.plugin(MemoryRuntime)
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    try {
      const fiber = await ctx.plugin(SqlitePlugin, { path: join(dir, 'memory.db'), retentionDays: 30, maxSearchResults: 5 })
      await fiber.dispose()
      expect(close).toHaveBeenCalledTimes(1)
      expect(() => ctx.memory.query({ scope: { kind: 'global' }, text: 'fact' })).toThrow('no memory provider is registered')
    } finally {
      close.mockRestore()
      await runtime.dispose()
    }
  })

  it('never applies automatic retention to global memory', async () => {
    const { db, provider } = await database()
    try {
      const project = { kind: 'project' as const, project: '/repo' }
      const global = { kind: 'global' as const }
      const projectProposal = await provider.propose({ scope: project, statement: 'Old project fact', evidence: [], trust: { score: 1, source: 'user' } })
      const globalProposal = await provider.propose({ scope: global, statement: 'Old global fact', evidence: [], trust: { score: 1, source: 'user' } })
      const projectRejected = await provider.review({ ref: { scope: project, id: projectProposal.id, revision: projectProposal.revision }, decision: 'reject' })
      const globalRejected = await provider.review({ ref: { scope: global, id: globalProposal.id, revision: globalProposal.revision }, decision: 'reject' })
      db.prepare('UPDATE memories SET updated_at = 0').run()

      new SqliteMemoryProvider(db, 10, 1)
      await expect(provider.get(project, projectRejected.id)).resolves.toBeUndefined()
      await expect(provider.get(global, globalRejected.id)).resolves.toMatchObject({ id: globalRejected.id })
    } finally {
      db.close()
    }
  })
})
