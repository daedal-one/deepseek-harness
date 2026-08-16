import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { MemoryError, MemoryId } from '@deepseek-ai/dsh-memory'
import type { MemoryChallenge, MemoryCheckpoint, MemoryEvidence, MemoryProposal, MemoryProvider, MemoryQuery, MemoryQueryResult, MemoryRecord, MemoryRef, MemoryReview, MemoryScope, MemoryStatus, MemorySupersession, MemoryTrust, MemoryValidity } from '@deepseek-ai/dsh-memory'

interface MemoryRow {
  id: string
  revision: number
  scope_kind: 'project' | 'global'
  project: string | null
  statement: string
  status: MemoryStatus
  evidence_json: string
  trust_json: string
  validity_json: string
  contradicts_json: string
  challenge_json: string | null
  superseded_by: string | null
  created_at: number
  updated_at: number
  last_accessed_at: number
  access_count: number
}

/** SQLite-backed memory provider. */
// oxlint-disable typescript/require-await -- the provider interface stays asynchronous so remote stores can replace SQLite.
export class SqliteMemoryProvider implements MemoryProvider {
  readonly id = 'sqlite'
  constructor(private readonly db: DatabaseSync, private readonly maxSearchResults: number, retentionDays: number) {
    const cutoff = Date.now() - retentionDays * 86_400_000
    db.prepare("DELETE FROM memories WHERE scope_kind = 'project' AND status IN ('rejected', 'superseded') AND updated_at < ?").run(cutoff)
  }

  async query(request: MemoryQuery): Promise<MemoryQueryResult> {
    validateScope(request.scope)
    const text = request.text.trim()
    const requested = request.limit ?? this.maxSearchResults
    if (!Number.isSafeInteger(requested) || requested < 1) throw new MemoryError('memory query limit must be a positive safe integer', 'MEMORY_INVALID_LIMIT')
    const limit = Math.min(requested, this.maxSearchResults)
    const statuses = request.statuses ?? ['active']
    if (statuses.length === 0) return { memories: [], truncated: false }
    const scope = scopeFields(request.scope)
    const at = request.at ?? Date.now()
    const placeholders = statuses.map(() => '?').join(', ')
    const rows = this.db.prepare(`SELECT * FROM memories WHERE scope_kind = ? AND project IS ? AND status IN (${placeholders}) AND statement LIKE ? ESCAPE '\\' AND (json_extract(validity_json, '$.validFrom') IS NULL OR json_extract(validity_json, '$.validFrom') <= ?) AND (json_extract(validity_json, '$.validUntil') IS NULL OR json_extract(validity_json, '$.validUntil') > ?) ORDER BY updated_at DESC LIMIT ?`).all(scope.kind, scope.project, ...statuses, `%${escapeLike(text)}%`, at, at, limit + 1) as unknown as MemoryRow[]
    return { memories: rows.slice(0, limit).map(rowToRecord), truncated: rows.length > limit }
  }

  async get(scope: MemoryScope, id: MemoryId): Promise<MemoryRecord | undefined> {
    validateScope(scope)
    const fields = scopeFields(scope)
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ? AND scope_kind = ? AND project IS ?').get(id, fields.kind, fields.project) as MemoryRow | undefined
    return row === undefined ? undefined : rowToRecord(row)
  }

  async propose(request: MemoryProposal): Promise<MemoryRecord> {
    validateProposal(request)
    validateContradictions(this.db, request.scope, request.contradicts ?? [])
    const now = Date.now()
    const record: MemoryRecord = {
      id: MemoryId(`mem-${randomUUID()}`), revision: 1, scope: request.scope,
      statement: request.statement.trim(), status: 'proposed', evidence: [...request.evidence],
      trust: request.trust, validity: request.validity ?? {}, contradicts: [...request.contradicts ?? []],
      createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0,
    }
    insertRecord(this.db, record)
    return record
  }

  async challenge(request: MemoryChallenge): Promise<MemoryRecord> {
    const reason = requireText(request.reason, 'challenge reason')
    const current = requireCurrent(this.db, request.ref)
    if (current.status === 'rejected' || current.status === 'superseded') throw new MemoryError(`memory "${current.id}" cannot be challenged from status "${current.status}"`, 'MEMORY_INVALID_TRANSITION')
    return updateRecord(this.db, { ...current, revision: current.revision + 1, status: 'challenged', challenge: { reason, evidence: [...request.evidence ?? []] }, updatedAt: Date.now() })
  }

  async review(request: MemoryReview): Promise<MemoryRecord> {
    const current = requireCurrent(this.db, request.ref)
    if (current.status !== 'proposed' && current.status !== 'challenged') throw new MemoryError(`memory "${current.id}" cannot be reviewed from status "${current.status}"`, 'MEMORY_INVALID_TRANSITION')
    if (request.trust !== undefined) validateTrust(request.trust)
    return updateRecord(this.db, { ...current, revision: current.revision + 1, status: request.decision === 'accept' ? 'active' : 'rejected', trust: request.trust ?? current.trust, updatedAt: Date.now() })
  }

  async supersede(request: MemorySupersession): Promise<{ readonly previous: MemoryRecord; readonly replacement: MemoryRecord }> {
    validateProposal(request.replacement)
    const current = requireCurrent(this.db, request.ref)
    if (!scopesEqual(current.scope, request.replacement.scope)) throw new MemoryError('a superseding memory must remain in the previous memory scope', 'MEMORY_SCOPE_MISMATCH')
    validateContradictions(this.db, request.replacement.scope, request.replacement.contradicts ?? [])
    if (current.status !== 'active' && current.status !== 'challenged') throw new MemoryError(`memory "${current.id}" cannot be superseded from status "${current.status}"`, 'MEMORY_INVALID_TRANSITION')
    const replacementId = MemoryId(`mem-${randomUUID()}`)
    const now = Date.now()
    const replacement: MemoryRecord = { id: replacementId, revision: 1, scope: request.replacement.scope, statement: request.replacement.statement.trim(), status: 'active', evidence: [...request.replacement.evidence], trust: request.replacement.trust, validity: request.replacement.validity ?? {}, contradicts: [...request.replacement.contradicts ?? []], createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0 }
    const previous: MemoryRecord = { ...current, revision: current.revision + 1, status: 'superseded', supersededBy: replacementId, updatedAt: now }
    transaction(this.db, () => { insertRecord(this.db, replacement); updateRecord(this.db, previous) })
    return { previous, replacement }
  }

  async checkpoint(request: MemoryCheckpoint): Promise<readonly MemoryRecord[]> {
    const keys = request.refs.map(ref => `${scopeKey(ref.scope)}\0${ref.id}`)
    if (new Set(keys).size !== keys.length) throw new MemoryError('memory checkpoint refs must be unique', 'MEMORY_INVALID_CHECKPOINT')
    const now = Date.now()
    const records: MemoryRecord[] = []
    transaction(this.db, () => {
      for (const ref of request.refs) {
        const current = requireCurrent(this.db, ref)
        const fields = scopeFields(ref.scope)
        const revision = current.revision + 1
        const changed = this.db.prepare('UPDATE memories SET revision = ?, last_accessed_at = ?, access_count = access_count + 1 WHERE id = ? AND revision = ? AND scope_kind = ? AND project IS ?').run(revision, now, ref.id, ref.revision, fields.kind, fields.project).changes
        if (changed !== 1) throw new MemoryError(`memory "${ref.id}" changed concurrently`, 'MEMORY_REVISION_CONFLICT')
        records.push({ ...current, revision, lastAccessedAt: now, accessCount: current.accessCount + 1 })
      }
    })
    return records
  }

  async delete(ref: MemoryRef): Promise<boolean> {
    requireCurrent(this.db, ref)
    const scope = scopeFields(ref.scope)
    return this.db.prepare('DELETE FROM memories WHERE id = ? AND revision = ? AND scope_kind = ? AND project IS ?').run(ref.id, ref.revision, scope.kind, scope.project).changes === 1
  }
}
// oxlint-enable typescript/require-await

function validateScope(scope: MemoryScope): void {
  if (scope.kind === 'project') {
    if (typeof scope.project !== 'string' || scope.project.length === 0 || !scope.project.startsWith('/')) throw new MemoryError('project memory scope requires an absolute project path', 'MEMORY_INVALID_SCOPE')
  }
}
function scopeFields(scope: MemoryScope): { kind: 'project' | 'global'; project: string | null } { return scope.kind === 'global' ? { kind: 'global', project: null } : { kind: 'project', project: scope.project } }
function scopeKey(scope: MemoryScope): string { return scope.kind === 'global' ? 'global' : `project:${scope.project}` }
function scopesEqual(left: MemoryScope, right: MemoryScope): boolean { return left.kind === right.kind && (left.kind === 'global' || (right.kind === 'project' && left.project === right.project)) }
function requireText(value: string, name: string): string { if (typeof value !== 'string' || value.trim().length === 0) throw new MemoryError(`${name} must be non-empty`, 'MEMORY_INVALID_TEXT'); return value.trim() }
function validateTrust(trust: MemoryTrust): void { if (!Number.isFinite(trust.score) || trust.score < 0 || trust.score > 1) throw new MemoryError('memory trust score must be from 0 through 1', 'MEMORY_INVALID_TRUST') }
function validateValidity(validity: MemoryValidity | undefined): void { if (validity?.validFrom !== undefined && (!Number.isSafeInteger(validity.validFrom) || validity.validFrom < 0)) throw new MemoryError('validFrom must be a non-negative safe integer', 'MEMORY_INVALID_VALIDITY'); if (validity?.validUntil !== undefined && (!Number.isSafeInteger(validity.validUntil) || validity.validUntil < 0)) throw new MemoryError('validUntil must be a non-negative safe integer', 'MEMORY_INVALID_VALIDITY'); if (validity?.validFrom !== undefined && validity.validUntil !== undefined && validity.validUntil <= validity.validFrom) throw new MemoryError('validUntil must be greater than validFrom', 'MEMORY_INVALID_VALIDITY') }
function validateProposal(request: MemoryProposal): void { validateScope(request.scope); requireText(request.statement, 'memory statement'); validateTrust(request.trust); validateValidity(request.validity); for (const evidence of request.evidence) validateEvidence(evidence) }
function validateEvidence(evidence: MemoryEvidence): void { requireText(evidence.ref, 'memory evidence ref') }
function escapeLike(value: string): string { return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') }

function requireCurrent(db: DatabaseSync, ref: MemoryRef): MemoryRecord {
  validateScope(ref.scope)
  if (!Number.isSafeInteger(ref.revision) || ref.revision < 1) throw new MemoryError('memory revision must be a positive safe integer', 'MEMORY_INVALID_REVISION')
  const scope = scopeFields(ref.scope)
  const row = db.prepare('SELECT * FROM memories WHERE id = ? AND scope_kind = ? AND project IS ?').get(ref.id, scope.kind, scope.project) as MemoryRow | undefined
  if (row === undefined) throw new MemoryError(`memory "${ref.id}" does not exist in the requested scope`, 'MEMORY_NOT_FOUND')
  if (row.revision !== ref.revision) throw new MemoryError(`memory "${ref.id}" is at revision ${row.revision}, not ${ref.revision}`, 'MEMORY_REVISION_CONFLICT')
  return rowToRecord(row)
}
function validateContradictions(db: DatabaseSync, scope: MemoryScope, ids: readonly MemoryId[]): void {
  for (const id of ids) {
    const row = db.prepare('SELECT scope_kind, project FROM memories WHERE id = ?').get(id) as Pick<MemoryRow, 'scope_kind' | 'project'> | undefined
    if (row === undefined) throw new MemoryError(`contradiction target "${id}" does not exist`, 'MEMORY_CONTRADICTION_NOT_FOUND')
    const target: MemoryScope = row.scope_kind === 'global' ? { kind: 'global' } : { kind: 'project', project: row.project as string }
    if (!scopesEqual(scope, target)) throw new MemoryError(`contradiction target "${id}" belongs to another scope`, 'MEMORY_SCOPE_MISMATCH')
  }
}
function rowToRecord(row: MemoryRow): MemoryRecord {
  const scope: MemoryScope = row.scope_kind === 'global' ? { kind: 'global' } : { kind: 'project', project: row.project as string }
  return {
    id: MemoryId(row.id),
    revision: row.revision,
    scope,
    statement: row.statement,
    status: row.status,
    evidence: JSON.parse(row.evidence_json) as MemoryEvidence[],
    trust: JSON.parse(row.trust_json) as MemoryTrust,
    validity: JSON.parse(row.validity_json) as MemoryValidity,
    contradicts: (JSON.parse(row.contradicts_json) as string[]).map(MemoryId),
    ...row.challenge_json === null
      ? {}
      : { challenge: JSON.parse(row.challenge_json) as { reason: string; evidence: MemoryEvidence[] } },
    ...row.superseded_by === null ? {} : { supersededBy: MemoryId(row.superseded_by) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
  }
}
function insertRecord(db: DatabaseSync, record: MemoryRecord): void { const scope = scopeFields(record.scope); db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.revision, scope.kind, scope.project, record.statement, record.status, JSON.stringify(record.evidence), JSON.stringify(record.trust), JSON.stringify(record.validity), JSON.stringify(record.contradicts), record.challenge === undefined ? null : JSON.stringify(record.challenge), record.supersededBy ?? null, record.createdAt, record.updatedAt, record.lastAccessedAt, record.accessCount) }
function updateRecord(db: DatabaseSync, record: MemoryRecord): MemoryRecord { const scope = scopeFields(record.scope); const changed = db.prepare('UPDATE memories SET revision=?, status=?, evidence_json=?, trust_json=?, validity_json=?, contradicts_json=?, challenge_json=?, superseded_by=?, updated_at=?, last_accessed_at=?, access_count=? WHERE id=? AND revision=? AND scope_kind=? AND project IS ?').run(record.revision, record.status, JSON.stringify(record.evidence), JSON.stringify(record.trust), JSON.stringify(record.validity), JSON.stringify(record.contradicts), record.challenge === undefined ? null : JSON.stringify(record.challenge), record.supersededBy ?? null, record.updatedAt, record.lastAccessedAt, record.accessCount, record.id, record.revision - 1, scope.kind, scope.project).changes; if (changed !== 1) throw new MemoryError(`memory "${record.id}" changed concurrently`, 'MEMORY_REVISION_CONFLICT'); return record }
function transaction(db: DatabaseSync, body: () => void): void { db.exec('BEGIN IMMEDIATE'); try { body(); db.exec('COMMIT') } catch (error: unknown) { try { db.exec('ROLLBACK') } catch { /* Preserve the operation failure. */ } throw error } }
