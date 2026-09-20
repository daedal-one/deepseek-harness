import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { importWorkspace, returnWorkspaceBranches, validateWorkspaceEntries, workspaceGit, publishWorkspaceJson, readWorkspaceJson } from '../src/workspace-git.ts'
import type { WorkspaceLimits } from '../src/workspace-git.ts'

const roots: string[] = []
const limits: WorkspaceLimits = { gitCommand: '/usr/bin/git', authorName: 'DSH', authorEmail: 'dsh@localhost', resourceLimitCommand: '/usr/bin/prlimit', gitMemoryBytes: 512 * 1024 * 1024, maxBytes: 8 * 1024 * 1024, maxEntries: 1000, timeoutMs: 30_000 }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-git-')); roots.push(root)
  const source = join(root, 'source'); const recovery = join(root, 'recovery'); await mkdir(source); await mkdir(recovery)
  const git = async (...args: string[]) => (await workspaceGit(source, args, limits)).toString().trim()
  await git('init', '--template=', '--initial-branch=main')
  await writeFile(join(source, 'tracked.txt'), 'original\n'); await writeFile(join(source, '.gitignore'), 'ignored\n')
  await git('add', '.'); await git('commit', '-m', 'initial')
  return { root, source, recovery, git }
}

describe.skipIf(process.platform === 'win32')('conversation workspace Git broker', () => {
  it('imports tracked edits and non-ignored new files into a labelled baseline without mutating the source', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'tracked.txt'), 'staged\n'); await f.git('add', 'tracked.txt')
    await writeFile(join(f.source, 'tracked.txt'), 'unstaged\n'); await writeFile(join(f.source, 'new.txt'), 'new\n'); await writeFile(join(f.source, 'ignored'), 'ignored secret\n')
    const head = await f.git('rev-parse', 'HEAD'); const index = await readFile(join(f.source, '.git/index'))
    const seed = await importWorkspace(f.source, f.recovery, limits)
    expect(seed.sourceHead).toBe(head); expect(seed.baseline).not.toBe(head)
    expect(seed.entries.find(e => e.path === 'tracked.txt')?.data).toBe(Buffer.from('unstaged\n').toString('base64'))
    expect(seed.entries.some(e => e.path === 'new.txt')).toBe(true)
    expect(seed.entries.some(e => e.path === 'ignored')).toBe(false)
    expect(seed.stagedPatch).not.toBe('')
    expect(await f.git('rev-parse', 'HEAD')).toBe(head)
    expect(await readFile(join(f.source, '.git/index'))).toEqual(index)
    expect(await readFile(join(f.source, 'tracked.txt'), 'utf8')).toBe('unstaged\n')
    expect(await readdir(f.recovery)).toEqual([])
  })
  it('keeps a clean source commit unchanged and gives independent imports the same input baseline', async () => {
    const f = await fixture()
    const [a, b] = await Promise.all([importWorkspace(f.source, f.recovery, limits), importWorkspace(f.source, f.recovery, limits)])
    expect(a.baseline).toBe(a.sourceHead); expect(b.baseline).toBe(a.baseline)
  })
  it('returns committed branches idempotently without changing source HEAD, index, or files', async () => {
    const f = await fixture(); const head = await f.git('rev-parse', 'HEAD'); const index = await readFile(join(f.source, '.git/index'))
    const bundle = await workspaceGit(f.source, ['bundle', 'create', '-', '--branches', 'HEAD'], limits)
    const refs = { 'refs/heads/main': head, HEAD: head }
    const a = await returnWorkspaceBranches(f.source, f.recovery, 'a'.repeat(32), 1, bundle, refs, limits)
    expect(await returnWorkspaceBranches(f.source, f.recovery, 'a'.repeat(32), 1, bundle, refs, limits)).toEqual(a)
    expect(Object.keys(a)).toHaveLength(2)
    expect(await f.git('rev-parse', 'HEAD')).toBe(head)
    expect(await readFile(join(f.source, '.git/index'))).toEqual(index)
    expect(await readFile(join(f.source, 'tracked.txt'), 'utf8')).toBe('original\n')
  })
  it('preserves a moved destination and returns rewritten history to a different turn generation', async () => {
    const f = await fixture(); const first = await f.git('rev-parse', 'HEAD')
    const bundle = await workspaceGit(f.source, ['bundle', 'create', '-', 'HEAD'], limits)
    const returned = await returnWorkspaceBranches(f.source, f.recovery, 'a'.repeat(32), 1, bundle, { HEAD: first }, limits)
    const [ref] = Object.keys(returned)
    if (ref === undefined) throw new Error('missing destination')
    await writeFile(join(f.source, 'tracked.txt'), 'concurrent host edit\n')
    await f.git('add', '.'); await f.git('commit', '-m', 'host change')
    const moved = await f.git('rev-parse', 'HEAD'); const index = await readFile(join(f.source, '.git/index'))
    await f.git('update-ref', ref, moved)
    await expect(returnWorkspaceBranches(f.source, f.recovery, 'a'.repeat(32), 1, bundle, { HEAD: first }, limits)).rejects.toThrow('changed externally')
    const next = await returnWorkspaceBranches(f.source, f.recovery, 'a'.repeat(32), 2, bundle, { HEAD: first }, limits)
    expect(Object.keys(next)).not.toContain(ref)
    expect(await f.git('rev-parse', ref)).toBe(moved)
    expect(await f.git('rev-parse', 'HEAD')).toBe(moved)
    expect(await readFile(join(f.source, '.git/index'))).toEqual(index)
    expect(await readFile(join(f.source, 'tracked.txt'), 'utf8')).toBe('concurrent host edit\n')
  })
  it('rejects corrupt bundle objects without creating host refs', async () => {
    const f = await fixture(); const head = await f.git('rev-parse', 'HEAD')
    const bundle = await workspaceGit(f.source, ['bundle', 'create', '-', 'HEAD'], limits)
    bundle[bundle.length - 1] = (bundle.at(-1) ?? 0) ^ 255
    await expect(returnWorkspaceBranches(f.source, f.recovery, 'a'.repeat(32), 1, bundle, { HEAD: head }, limits)).rejects.toThrow()
    expect(await f.git('for-each-ref', '--format=%(refname)', 'refs/heads/dsh')).toBe('')
  })
  it('rejects an unexpected bundle manifest before creating result refs', async () => {
    const f = await fixture(); const head = await f.git('rev-parse', 'HEAD')
    const bundle = await workspaceGit(f.source, ['bundle', 'create', '-', '--branches', 'HEAD'], limits)
    await expect(returnWorkspaceBranches(f.source, f.recovery, 'a'.repeat(32), 1, bundle, { HEAD: head }, limits)).rejects.toThrow('manifest')
    expect(await f.git('for-each-ref', '--format=%(refname)', 'refs/heads/dsh')).toBe('')
  })
  it('rejects escaping source links and does not copy ignored credentials', async () => {
    const f = await fixture(); await symlink('../outside', join(f.source, 'escape')); await writeFile(join(f.root, 'outside'), 'private')
    await expect(importWorkspace(f.source, f.recovery, limits)).rejects.toThrow('escapes')
    expect(await readdir(f.recovery)).toEqual([])
  })
  it('bounds complete recovery documents and retains the previous value when publication rejects', async () => {
    const f = await fixture(); const file = join(f.recovery, 'state.json')
    await publishWorkspaceJson(file, { text: 'saved' }, 32)
    await expect(publishWorkspaceJson(file, { text: 'x'.repeat(40) }, 32)).rejects.toThrow('bound')
    expect(await readWorkspaceJson(file, 32)).toEqual({ text: 'saved' })
    await expect(readWorkspaceJson(file, 4)).rejects.toThrow('bound')
  })
  it('rejects traversal, symlink parents, cyclic links, and complete-payload overflow', () => {
    const file = { path: '../escape', kind: 'file', data: '', mode: 0o600 }
    expect(() => validateWorkspaceEntries([file], limits)).toThrow('entry')
    expect(() => validateWorkspaceEntries([{ path: 'a', kind: 'link', data: 'b', mode: 0 }, { ...file, path: 'a/child' }], limits)).toThrow('parent')
    expect(() => validateWorkspaceEntries([{ path: 'a', kind: 'link', data: 'b', mode: 0 }, { path: 'b', kind: 'link', data: 'a', mode: 0 }], limits)).toThrow('cyclic')
    expect(() => validateWorkspaceEntries([{ ...file, path: 'f', data: 'YWJj' }], { ...limits, maxBytes: 2 })).toThrow('byte limit')
  })
})
