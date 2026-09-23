import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WORKSPACE_CONTROLLER } from '../src/workspace-controller.ts'
import type { WorkspaceEntry } from '../src/workspace-git.ts'
import { importWorkspace, workspaceGit } from '../src/workspace-git.ts'

const roots: string[] = []
const limits = { gitCommand: '/usr/bin/git', authorName: 'DSH', authorEmail: 'dsh@localhost', resourceLimitCommand: '/usr/bin/prlimit', gitMemoryBytes: 512 * 1024 * 1024, maxBytes: 8 * 1024 * 1024, maxEntries: 1000, timeoutMs: 30_000 }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
interface Responses {
  restore: Record<string, never>
  prepare: { tree: string; parent: string; clean: boolean; diff: string; summary: string }
  commit: { oid: string }
  capture: { entries: WorkspaceEntry[] }
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-workspace-controller-'))); roots.push(root)
  const source = join(root, 'source'); const recovery = join(root, 'recovery'); const execution = join(root, 'execution')
  await Promise.all([source, recovery, execution].map(path => mkdir(path)))
  await workspaceGit(source, ['init', '--template=', '--initial-branch=main'], limits)
  await writeFile(join(source, 'file.txt'), 'initial\n'); await workspaceGit(source, ['add', '.'], limits); await workspaceGit(source, ['commit', '-m', 'initial'], limits)
  const seed = await importWorkspace(source, recovery, limits)
  const controller = WORKSPACE_CONTROLLER.replace("ROOT='/workspace'", `ROOT=${JSON.stringify(execution)}`)
  const control = async <K extends keyof Responses>(operation: K, fields: Record<string, unknown> = {}): Promise<Responses[K]> => {
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile('/usr/bin/python3', ['-c', controller], { maxBuffer: 16 * 1024 * 1024, timeout: limits.timeoutMs }, (error, stdout) => { if (error === null) resolve(stdout); else reject(new Error('controller failed', { cause: error })) })
      child.stdin?.end(JSON.stringify({ operation, baseline: seed.baseline, ...fields, ...limits,
        maxOutputBytes: 16 * 1024 * 1024, timeoutSeconds: 20 }))
    })
    const parsed = JSON.parse(result) as { ok: boolean; error: string; value: Responses[K] }
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.value
  }
  await control('restore', { entries: seed.entries })
  return { root, source, execution, control }
}

describe.skipIf(process.platform === 'win32')('container workspace controller protocol', () => {
  it('creates the same residual commit on replay and preserves the original commit as parent', async () => {
    const f = await fixture(); await writeFile(join(f.execution, 'file.txt'), 'changed\n')
    const prepared = await f.control('prepare'); expect(prepared.clean).toBe(false)
    const request = { ...prepared, timestamp: '2026-09-20T10:00:00Z', message: 'fix: update file\n\nDSH-Turn: 1\n' }
    const first = await f.control('commit', request); const replay = await f.control('commit', request)
    expect(first).toEqual(replay)
    expect((await workspaceGit(f.execution, ['rev-parse', 'HEAD^'], limits)).toString().trim()).toBe(prepared.parent)
    const clean = await f.control('prepare')
    expect(clean.clean).toBe(true)
    expect(clean.diff).toBe('')
    expect(clean.summary).toContain('file.txt')
    expect(await readFile(join(f.source, 'file.txt'), 'utf8')).toBe('initial\n')
  })
  it('checkpoints ignored data and index bytes and restores them into an empty workspace', async () => {
    const f = await fixture(); await writeFile(join(f.execution, '.gitignore'), 'cache\n'); await writeFile(join(f.execution, 'cache'), 'private recovery data')
    const snapshot = await f.control('capture')
    expect(snapshot.entries.some((e: { path: string }) => e.path === 'cache')).toBe(true)
    expect(snapshot.entries.some((e: { path: string }) => e.path === '.git/index')).toBe(true)
    await expect(f.control('restore', snapshot)).rejects.toThrow('empty')
    await rm(f.execution, { recursive: true }); await mkdir(f.execution)
    await f.control('restore', snapshot)
    expect(await readFile(join(f.execution, 'cache'), 'utf8')).toBe('private recovery data')
  })
  it('does not invoke repository hooks or configured clean filters when committing residual changes', async () => {
    const f = await fixture()
    const marker = join(f.root, 'hook-ran')
    await mkdir(join(f.execution, '.git/hooks'))
    await writeFile(join(f.execution, '.git/hooks/pre-commit'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 })
    await workspaceGit(f.execution, ['config', 'filter.evil.clean', `touch '${marker}'`], limits)
    await writeFile(join(f.execution, '.gitattributes'), '*.txt filter=evil\n')
    await writeFile(join(f.execution, 'file.txt'), 'raw bytes\n')
    const prepared = await f.control('prepare')
    await f.control('commit', { ...prepared, timestamp: '2026-09-20T10:00:00Z', message: 'save' })
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await workspaceGit(f.execution, ['show', 'HEAD:file.txt'], limits)).toString()).toBe('raw bytes\n')
  })
})
