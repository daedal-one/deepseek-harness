import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it } from 'vitest'
import type { ConversationWorkspaceId, WorkspaceProvenance, WorkspaceProvenanceId } from '../src/workspace-types.ts'
import { lookupWorkspaceProvenance, parseWorkspaceProvenance, saveWorkspaceProvenance } from '../src/workspace-provenance.ts'
import { workspaceResultRef } from '../src/workspace-git.ts'
import { workspaceTopic } from '../src/workspace-names.ts'

// The Linux workspace receipt publisher requires POSIX directory fsync and symlinks.
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root() { const directory = await mkdtemp(join(tmpdir(), 'dsh-provenance-')); roots.push(directory); return directory }
function receipt(): WorkspaceProvenance {
  return { version: 1, id: brandString<WorkspaceProvenanceId>(randomUUID()), workspaceId: brandString<ConversationWorkspaceId>('a'.repeat(32)),
    sessionId: SessionId('conversation-one'), turn: 1, eventRange: [SessionSeq(0), SessionSeq(8)], repository: '/project/one',
    baseline: 'b'.repeat(40), createdAt: '2026-09-23T12:00:00Z',
    refs: [{ source: 'HEAD', branch: 'refs/heads/dsh/fix-recovery/turn-1', commit: 'c'.repeat(40), topic: 'fix-recovery' }],
    observedCommits: ['c'.repeat(40), 'd'.repeat(40)], createdCommits: ['c'.repeat(40)] }
}
const limits = { maxBytes: 65536, maxEntries: 100 }
const signal = () => new AbortController().signal

it.skipIf(process.platform === 'win32')('keeps concurrent identical publication idempotent and rejects an identity conflict', async () => {
  const directory = await root(); const record = receipt()
  await Promise.all([
    saveWorkspaceProvenance(directory, record, limits.maxBytes), saveWorkspaceProvenance(directory, record, limits.maxBytes),
  ])
  expect(await readdir(directory)).toEqual([`${record.id}.json`])
  await expect(saveWorkspaceProvenance(directory, { ...record, sessionId: SessionId('other') }, limits.maxBytes)).rejects.toThrow('identity conflict')
  expect((await lookupWorkspaceProvenance(directory, record.id, limits, signal())).records).toEqual([record])
})

it.skipIf(process.platform === 'win32')('finds intermediate commits across conversations and repositories without Git access', async () => {
  const directory = await root(); const first = receipt(); const second = { ...receipt(), sessionId: SessionId('conversation-two'), repository: '/project/two' }
  await saveWorkspaceProvenance(directory, first, limits.maxBytes)
  await saveWorkspaceProvenance(directory, second, limits.maxBytes)
  const result = await lookupWorkspaceProvenance(directory, 'd'.repeat(12), limits, signal())
  expect(result.records.map(record => record.sessionId).sort()).toEqual(['conversation-one', 'conversation-two'])
  expect(result.records.every(record => record.createdCommits.length === 1 && !record.createdCommits.includes('d'.repeat(40)))).toBe(true)
  for (const query of ['FIX-RECOVERY', first.id, first.sessionId, first.refs[0]!.branch]) {
    expect((await lookupWorkspaceProvenance(directory, query, limits, signal())).records).toContainEqual(first)
  }
  expect(JSON.parse(JSON.stringify(result))).toEqual(result)
})

it.skipIf(process.platform === 'win32')('reports output truncation, honors cancellation and bounds disk records', async () => {
  const directory = await root()
  await saveWorkspaceProvenance(directory, receipt(), limits.maxBytes)
  await saveWorkspaceProvenance(directory, receipt(), limits.maxBytes)
  expect(await lookupWorkspaceProvenance(directory, '', { ...limits, maxEntries: 1 }, signal())).toMatchObject({ records: [expect.anything()], truncated: true })
  await expect(lookupWorkspaceProvenance(directory, '', limits, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
  await expect(lookupWorkspaceProvenance(directory, '', { ...limits, maxBytes: 10 }, signal())).rejects.toThrow('bound')
  await expect(saveWorkspaceProvenance(directory, receipt(), 10)).rejects.toThrow('bound')
  expect(await lookupWorkspaceProvenance(join(directory, 'absent'), '', limits, signal())).toEqual({ records: [], truncated: false })
})

it.skipIf(process.platform === 'win32')('refuses replaced symlinks, malformed receipts and false authorship relations', async () => {
  const directory = await root(); const record = receipt()
  await writeFile(join(directory, 'private'), JSON.stringify(record))
  await symlink(join(directory, 'private'), join(directory, `${record.id}.json`))
  await expect(lookupWorkspaceProvenance(directory, '', limits, signal())).rejects.toThrow('entry')
  expect(() => parseWorkspaceProvenance({ ...record, createdCommits: ['e'.repeat(40)] })).toThrow('relationships')
  expect(() => parseWorkspaceProvenance({ ...record, eventRange: [8, 0] })).toThrow('receipt')
  expect(() => parseWorkspaceProvenance(null)).toThrow('receipt')
})

it('keeps generated words separate from deterministic workspace and branch identity', () => {
  const workspace = 'a'.repeat(32)
  const first = workspaceResultRef(workspace, 1, 'HEAD', 'fix-recovery')
  expect(first).toMatch(/^refs\/heads\/dsh\/fix-recovery-[a-f0-9]{24}\/turn-1$/u)
  expect(workspaceResultRef(workspace, 2, 'HEAD', 'fix-recovery')).toBe(first.replace('turn-1', 'turn-2'))
  expect(workspaceResultRef('b'.repeat(32), 1, 'HEAD', 'fix-recovery')).not.toBe(first)
  expect(workspaceResultRef(workspace, 1, 'refs/heads/main', 'fix-recovery')).not.toBe(first)
  expect(() => workspaceResultRef(workspace, 1, 'HEAD', '../escape')).toThrow('topic')
  expect(workspaceTopic('Fix: café / recovery!')).toBe('fix-cafe-recovery')
  expect(workspaceTopic('你好')).toBe('changes')
})
