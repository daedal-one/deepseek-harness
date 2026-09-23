/** Immutable return receipts and bounded host-wide lookup, independent of Git ref lifetime. @module */
import { link, mkdir, open, opendir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkspaceProvenance } from './workspace-types.ts'
import { publishWorkspaceJson, readWorkspaceJson } from './workspace-git.ts'

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const OID = /^[a-f0-9]{40}$/u

/** Validate a receipt read from disk or portable metadata.
 * @param value - untrusted decoded JSON.
 * @returns validated receipt; malformed metadata throws.
 */
export function parseWorkspaceProvenance(value: unknown): WorkspaceProvenance {
  if (!isRecord(value)) throw new Error('invalid workspace provenance receipt')
  const record = value
  if (record.version !== 1 || typeof record.id !== 'string' || !UUID.test(record.id)
    || typeof record.workspaceId !== 'string' || !/^[a-f0-9]{32}$/u.test(record.workspaceId)
    || typeof record.sessionId !== 'string' || !record.sessionId
    || typeof record.repository !== 'string' || !record.repository
    || typeof record.baseline !== 'string' || !OID.test(record.baseline)
    || typeof record.turn !== 'number' || !Number.isSafeInteger(record.turn) || record.turn < 1
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || !Array.isArray(record.eventRange) || record.eventRange.length !== 2
    || record.eventRange.some((seq: unknown) => typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0)
    || Number(record.eventRange[0]) > Number(record.eventRange[1])
    || !Array.isArray(record.refs) || record.refs.length === 0 || !record.refs.every(validRef)
    || !isOidList(record.observedCommits) || !isOidList(record.createdCommits)) {
    throw new Error('invalid workspace provenance receipt')
  }
  const result = record as unknown as WorkspaceProvenance
  const observed = new Set(result.observedCommits)
  if (result.createdCommits.some(oid => !observed.has(oid)) || result.refs.some(ref => !observed.has(ref.commit))) {
    throw new Error('workspace provenance commit relationships are invalid')
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isOidList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((oid: unknown) => typeof oid === 'string' && OID.test(oid))
}
function validRef(value: unknown): boolean {
  return isRecord(value) && typeof value.source === 'string' && (value.source === 'HEAD' || /^refs\/heads\/[^\x00-\x20\x7f]+$/u.test(value.source))
    && typeof value.branch === 'string' && /^refs\/heads\/dsh\/[^\x00-\x20\x7f]+$/u.test(value.branch)
    && typeof value.topic === 'string' && value.topic.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.topic)
    && typeof value.commit === 'string' && OID.test(value.commit)
}

/** Publish an immutable receipt, accepting only byte-identical retries.
 * @param root - trusted private global provenance directory.
 * @param receipt - complete validated return metadata.
 * @param maxBytes - complete serialized receipt limit.
 */
export async function saveWorkspaceProvenance(root: string, receipt: WorkspaceProvenance, maxBytes: number): Promise<void> {
  parseWorkspaceProvenance(receipt)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const destination = join(root, `${receipt.id}.json`)
  const temporary = join(root, `${randomUUID()}.pending`)
  await publishWorkspaceJson(temporary, receipt, maxBytes)
  try {
    try { await link(temporary, destination) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const previous = parseWorkspaceProvenance(await readWorkspaceJson(destination, maxBytes))
      if (JSON.stringify(previous) !== JSON.stringify(receipt)) throw new Error('workspace provenance receipt identity conflict')
    }
    const directory = await open(root, 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await rm(temporary, { force: true }) }
}

/** Search durable metadata without opening transcripts or trusting current Git refs.
 * @param root - trusted global provenance directory.
 * @param query - case-insensitive literal text; empty selects every receipt.
 * @param limits - per-record and complete-result byte and record limits.
 * @param signal - caller cancellation and deadline.
 * @returns bounded receipts and an explicit truncation indicator; each query rebuilds its view from authoritative records.
 */
export async function lookupWorkspaceProvenance(
  root: string, query: string, limits: { maxBytes: number; maxEntries: number }, signal: AbortSignal,
): Promise<{ records: WorkspaceProvenance[]; truncated: boolean }> {
  signal.throwIfAborted()
  let directory
  try { directory = await opendir(root) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], truncated: false }; throw error }
  const records: WorkspaceProvenance[] = []
  let bytes = Buffer.byteLength('{"records":[],"truncated":false}')
  let truncated = false
  const needle = query.toLowerCase()
  for await (const entry of directory) {
    signal.throwIfAborted()
    if (!entry.name.endsWith('.json')) continue
    if (!UUID.test(entry.name.slice(0, -5)) || !entry.isFile()) throw new Error('invalid workspace provenance entry')
    const receipt = parseWorkspaceProvenance(await readWorkspaceJson(join(root, entry.name), limits.maxBytes))
    if (`${receipt.id}.json` !== entry.name) throw new Error('workspace provenance filename differs from its identity')
    const data = JSON.stringify(receipt)
    if (!data.toLowerCase().includes(needle)) continue
    const size = Buffer.byteLength(data) + (records.length === 0 ? 0 : 1)
    if (records.length >= limits.maxEntries || bytes + size > limits.maxBytes) { truncated = true; break }
    records.push(receipt); bytes += size
  }
  signal.throwIfAborted()
  return { records: records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), truncated }
}
