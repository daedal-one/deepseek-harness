/** Host-owned Git import and validated immutable branch return. @module */

import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Bounded transport entry. Directory entries precede their children. */
export interface WorkspaceEntry {
  path: string
  kind: 'directory' | 'file' | 'link'
  data: string
  mode: number
}

/** Host command and transport limits, resolved from deployment configuration. */
export interface WorkspaceLimits {
  gitCommand: string
  authorName: string
  authorEmail: string
  resourceLimitCommand: string
  gitMemoryBytes: number
  maxBytes: number
  maxEntries: number
  timeoutMs: number
}

/** Imported source identity and the labelled starting tree. */
export interface WorkspaceSeed {
  source: string
  sourceHead: string
  baseline: string
  sourceStatus: string
  stagedPatch: string
  entries: WorkspaceEntry[]
}

/** Run Git without ambient credentials, global configuration, hooks, or network transports.
 * @param cwd - trusted host repository or private staging directory.
 * @param args - owner-selected Git arguments.
 * @param limits - executable, output, and deadline bounds.
 * @param input - optional stdin bytes.
 * @returns bounded stdout.
 */
export async function workspaceGit(cwd: string, args: string[], limits: WorkspaceLimits, input?: Uint8Array): Promise<Buffer> {
  return await new Promise((accept, reject) => {
    const arguments_ = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'protocol.allow=never', '-c', 'gc.auto=0', ...args]
    const linux = process.platform === 'linux'
    const child = spawn(linux ? limits.resourceLimitCommand : limits.gitCommand,
      linux ? [`--as=${limits.gitMemoryBytes}`, `--fsize=${limits.maxBytes}`, `--cpu=${Math.ceil(limits.timeoutMs / 1000)}`, '--', limits.gitCommand, ...arguments_] : arguments_, {
        cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: dirname(limits.gitCommand) + ':/usr/bin:/bin', HOME: cwd, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_AUTHOR_NAME: limits.authorName, GIT_AUTHOR_EMAIL: limits.authorEmail, GIT_COMMITTER_NAME: limits.authorName, GIT_COMMITTER_EMAIL: limits.authorEmail, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' },
      })
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let bytes = 0; let failure: Error | undefined
    const stop = (error: Error): void => {
      failure ??= error
      if (child.pid !== undefined) {
        try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL') }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') failure = new Error('workspace Git process cleanup failed', { cause }) }
      }
    }
    const timer = setTimeout(() =>{  stop(new Error('workspace Git command deadline exceeded')) }, limits.timeoutMs)
    const collect = (target: Buffer[]) => (chunk: Buffer): void => {
      bytes += chunk.length
      if (bytes > limits.maxBytes) stop(new Error('workspace Git output limit exceeded'))
      else target.push(chunk)
    }
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr))
    child.on('error', (error) => { failure = error })
    child.stdin.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failure !== undefined) reject(failure)
      else if (code !== 0) reject(new Error(`workspace Git ${args[0]} failed: ${Buffer.concat(stderr).toString('utf8').slice(0, 2048)}`))
      else accept(Buffer.concat(stdout))
    })
    child.stdin.end(input)
  })
}

/** Atomically publish durable JSON, retaining the previous named generation.
 * @param path - supervisor-owned destination outside the sandbox.
 * @param value - serializable state.
 * @param maxBytes - complete serialized document bound.
 */
export async function publishWorkspaceJson(path: string, value: unknown, maxBytes: number): Promise<void> {
  const data = JSON.stringify(value)
  if (Buffer.byteLength(data) > maxBytes) throw new Error('workspace recovery document exceeds its bound')
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    try { await file.writeFile(data); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await rm(temporary, { force: true }) }
}

/** Read one bounded owner-owned recovery document without following a replaced link.
 * @param path - private recovery document.
 * @param maxBytes - maximum serialized document size.
 * @returns parsed JSON for domain validation.
 */
export async function readWorkspaceJson(path: string, maxBytes: number): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > maxBytes) throw new Error('workspace recovery document exceeds its bound')
    const data = Buffer.alloc(info.size + 1)
    let bytes = 0
    while (bytes < data.length) {
      const result = await file.read(data, bytes, data.length - bytes, bytes)
      if (result.bytesRead === 0) break
      bytes += result.bytesRead
    }
    if (bytes !== info.size) throw new Error('workspace recovery document changed while reading')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, bytes))) as unknown
  } finally { await file.close() }
}

function text(value: Uint8Array): string { return new TextDecoder('utf-8', { fatal: true }).decode(value) }
function oid(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error('workspace requires a SHA-1 Git repository')
  return value
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}

/** Validate the complete transport before writing any bytes.
 * @param value - decoded untrusted controller or recovery payload.
 * @param limits - complete entry and decoded byte bounds.
 * @returns validated entries with no ambiguous or escaping paths.
 */
export function validateWorkspaceEntries(value: unknown, limits: WorkspaceLimits): WorkspaceEntry[] {
  if (!Array.isArray(value) || value.length > limits.maxEntries) throw new Error('invalid workspace entry count')
  const entries: WorkspaceEntry[] = []; const kinds = new Map<string, string>(); let bytes = 0
  for (const item of value) {
    if (typeof item !== 'object' || item === null) throw new Error('invalid workspace entry')
    const e = item as Record<string, unknown>
    if (typeof e.path !== 'string' || e.path.startsWith('/') || e.path.includes('\\') || e.path.includes('\0') || e.path.split('/').some(p => p === '' || p === '.' || p === '..')
      || typeof e.data !== 'string' || typeof e.mode !== 'number' || !Number.isInteger(e.mode) || e.mode < 0 || e.mode > 0o777
      || (e.kind !== 'directory' && e.kind !== 'file' && e.kind !== 'link') || kinds.has(e.path)) throw new Error('invalid workspace entry')
    const parent = dirname(e.path)
    if (parent !== '.' && kinds.get(parent) !== 'directory') throw new Error('workspace entry has an absent or symlink parent')
    if (e.kind === 'link') {
      if (isAbsolute(e.data) || e.data.includes('\\') || e.data.includes('\0') || !inside('/workspace', resolve('/workspace', parent, e.data))) throw new Error('escaping workspace symlink')
      bytes += Buffer.byteLength(e.data)
    } else if (e.kind === 'file') {
      const data = Buffer.from(e.data, 'base64')
      if (data.toString('base64') !== e.data) throw new Error('invalid workspace file encoding')
      bytes += data.length
    } else if (e.data !== '') throw new Error('invalid workspace directory data')
    if (bytes > limits.maxBytes) throw new Error('workspace byte limit exceeded')
    kinds.set(e.path, e.kind); entries.push({ path: e.path, kind: e.kind, data: e.data, mode: e.mode })
  }
  const links = new Map(entries.filter(e => e.kind === 'link').map(e => [e.path, e.data]))
  for (const [name, target] of links) {
    let current = join(dirname(name), target); const visited = new Set([name])
    for (let count = 0; count <= links.size; count++) {
      const parts = current.split('/'); let replaced = false
      for (let n = 1; n <= parts.length; n++) {
        const prefix = parts.slice(0, n).join('/'); const next = links.get(prefix)
        if (next === undefined) continue
        if (visited.has(prefix)) throw new Error('cyclic workspace symlink')
        visited.add(prefix); current = join(dirname(prefix), next, ...parts.slice(n))
        if (!inside('/workspace', resolve('/workspace', current))) throw new Error('escaping workspace symlink chain')
        replaced = true; break
      }
      if (!replaced) break
    }
  }
  return entries
}

async function snapshot(directory: string, limits: WorkspaceLimits): Promise<WorkspaceEntry[]> {
  const entries: WorkspaceEntry[] = []; let bytes = 0
  const visit = async (path: string): Promise<void> => {
    for (const name of (await readdir(path)).sort()) {
      const full = join(path, name); const info = await lstat(full); const rel = relative(directory, full)
      if (entries.length >= limits.maxEntries) throw new Error('workspace entry limit exceeded')
      if (info.isDirectory()) { entries.push({ path: rel, kind: 'directory', data: '', mode: info.mode & 0o777 }); await visit(full) }
      else if (info.isSymbolicLink()) { entries.push({ path: rel, kind: 'link', data: await readlink(full), mode: 0 }) }
      else if (info.isFile()) {
        bytes += info.size
        if (bytes > limits.maxBytes) throw new Error('workspace byte limit exceeded')
        const data = await readFile(full)
        entries.push({ path: rel, kind: 'file', data: data.toString('base64'), mode: info.mode & 0o777 })
      } else throw new Error('special files cannot be imported')
    }
  }
  await visit(directory)
  return validateWorkspaceEntries(entries, limits)
}

/** Import current selected files into a fresh repository without touching the source index.
 * @param source - validated host checkout root.
 * @param recoveryRoot - owner-only staging root outside the sandbox.
 * @param limits - explicit command and transport bounds.
 * @returns complete private seed and input provenance.
 */
export async function importWorkspace(source: string, recoveryRoot: string, limits: WorkspaceLimits): Promise<WorkspaceSeed> {
  const canonical = await realpath(source)
  const git = async (...args: string[]): Promise<Buffer> => workspaceGit(canonical, args, limits)
  if (await realpath(text(await git('rev-parse', '--show-toplevel')).trim()) !== canonical) throw new Error('select a Git repository root for the conversation')
  if (text(await git('rev-parse', '--show-object-format')).trim() !== 'sha1') throw new Error('SHA-256 repositories are not supported')
  if (text(await git('rev-parse', '--is-shallow-repository')).trim() !== 'false') throw new Error('shallow repositories are not supported')
  if ((await git('ls-files', '-u')).length > 0) throw new Error('resolve the source index conflicts before importing')
  if (/^160000 /mu.test(text(await git('ls-files', '--stage')))) throw new Error('submodules require separate workspace support')
  const configuration = text(await git('config', '--local', '--list'))
  if (/^(extensions\.partialclone|core\.sparsecheckout|remote\.[^.]+\.promisor)=/imu.test(configuration)) throw new Error('partial and sparse repositories are not supported')
  const sourceHead = oid(text(await git('rev-parse', 'HEAD')).trim())
  const sourceStatus = text(await git('status', '--porcelain=v2', '-z', '--untracked-files=all'))
  const stagedPatch = (await git('diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv')).toString('base64')
  const paths = [...new Set(text(await git('ls-files', '--cached', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean))].sort()
  if (paths.length > limits.maxEntries) throw new Error('source entry limit exceeded')
  const staging = await mkdtemp(join(recoveryRoot, 'import-')); await chmod(staging, 0o700)
  try {
    const bundle = join(staging, 'input.bundle'); const repo = join(staging, 'repository'); await mkdir(repo, { mode: 0o700 })
    await writeFile(bundle, await git('bundle', 'create', '-', 'HEAD'), { mode: 0o600 })
    const stage = async (...args: string[]): Promise<Buffer> => workspaceGit(repo, args, limits)
    await stage('init', '--template=', '--initial-branch=codex/conversation')
    await stage('bundle', 'verify', bundle)
    await stage('bundle', 'unbundle', bundle)
    await stage('update-ref', 'refs/heads/codex/conversation', sourceHead)
    await stage('config', '--local', 'user.name', limits.authorName)
    await stage('config', '--local', 'user.email', limits.authorEmail)
    const signatures = new Map<string, string>(); let bytes = 0
    const copy = async (path: string, write: boolean): Promise<string> => {
      if (!inside(canonical, resolve(canonical, path)) || path.split('/').includes('.git')) throw new Error('invalid source pathname')
      const full = join(canonical, path)
      let parent = canonical
      for (const component of path.split('/').slice(0, -1)) {
        parent = join(parent, component)
        let metadata
        try { metadata = await lstat(parent) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'deleted'; throw error }
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('source parent is not a real directory')
      }
      let info
      try { info = await lstat(full) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'deleted'; throw error }
      const destination = join(repo, path)
      if (write) await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      if (info.isSymbolicLink()) {
        const target = await readlink(full)
        if (isAbsolute(target) || !inside(canonical, await realpath(full))) throw new Error('source symlink escapes the repository')
        if (write) await symlink(target, destination)
        return `link:${target}`
      }
      if (!info.isFile()) throw new Error('nested repositories and special files require separate workspace support')
      if (info.size > limits.maxBytes) throw new Error('source file byte limit exceeded')
      const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW); let data: Buffer
      try {
        const current = await file.stat()
        if (!current.isFile() || current.ino !== info.ino || current.dev !== info.dev || current.size > limits.maxBytes) throw new Error('source changed during workspace import')
        const buffer = Buffer.alloc(Math.min(limits.maxBytes + 1, current.size + 1))
        const read = await file.read(buffer, 0, buffer.length, 0)
        data = buffer.subarray(0, read.bytesRead)
        if (data.length !== current.size) throw new Error('source changed during workspace import')
      } finally { await file.close() }
      if (data.subarray(0, 200).toString().startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('Git LFS inputs require payload support')
      if (write) { bytes += data.length; if (bytes > limits.maxBytes) throw new Error('source byte limit exceeded'); await writeFile(destination, data, { mode: info.mode & 0o777 }) }
      return createHash('sha256').update(data).update(String(info.mode & 0o777)).digest('hex')
    }
    for (const path of paths) signatures.set(path, await copy(path, true))
    for (const path of paths) if (signatures.get(path) !== await copy(path, false)) throw new Error('source changed during workspace import; retry preparation')
    if (sourceHead !== text(await git('rev-parse', 'HEAD')).trim() || sourceStatus !== text(await git('status', '--porcelain=v2', '-z', '--untracked-files=all'))
      || stagedPatch !== (await git('diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv')).toString('base64')) throw new Error('source changed during workspace import; retry preparation')
    await stage('add', '--all', '--', '.')
    const tree = text(await stage('write-tree')).trim(); let baseline = sourceHead
    if (tree !== text(await stage('rev-parse', 'HEAD^{tree}')).trim()) {
      baseline = oid(text(await workspaceGit(repo, ['commit-tree', tree, '-p', sourceHead], limits, Buffer.from('chore: record conversation input baseline\n\nDSH-Input-Baseline: true\n'))).trim())
      await stage('update-ref', 'refs/heads/codex/conversation', baseline, sourceHead)
    }
    return { source: canonical, sourceHead, baseline, sourceStatus, stagedPatch, entries: await snapshot(repo, limits) }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

/** Validate a sandbox bundle and atomically create immutable result branches in the host repository.
 * @param source - recorded source repository root, never a sandbox-supplied path.
 * @param stagingRoot - private broker staging root.
 * @param workspaceId - host-generated hexadecimal workspace identity.
 * @param turn - durable completed-turn number.
 * @param bundle - bounded bundle bytes captured in the sandbox.
 * @param heads - exact declared branch/object manifest.
 * @param limits - resource bounds for validation and host Git commands.
 * @returns host result refs mapped to immutable object ids.
 */
export async function returnWorkspaceBranches(
  source: string, stagingRoot: string, workspaceId: string, turn: number,
  bundle: Buffer, heads: Record<string, string>, limits: WorkspaceLimits,
): Promise<Record<string, string>> {
  if (!/^[a-f0-9]{32}$/u.test(workspaceId) || !Number.isSafeInteger(turn) || turn < 1 || bundle.length > limits.maxBytes) throw new Error('invalid workspace return identity or size')
  const declared = Object.entries(heads)
  if (declared.length === 0 || declared.length > limits.maxEntries) throw new Error('invalid workspace return manifest')
  for (const [ref, hash] of declared) { oid(hash); if (ref !== 'HEAD' && !/^refs\/heads\/[^\x00-\x20\x7f]+$/u.test(ref)) throw new Error('invalid workspace source ref') }
  const staging = await mkdtemp(join(stagingRoot, 'return-'))
  try {
    const file = join(staging, 'result.bundle'); const repo = join(staging, 'validate'); await mkdir(repo, { mode: 0o700 }); await writeFile(file, bundle, { mode: 0o600 })
    const git = async (...args: string[]): Promise<Buffer> => workspaceGit(repo, args, limits)
    await git('init', '--bare', '--template=')
    await git('bundle', 'verify', file)
    const advertised = Object.fromEntries(text(await git('bundle', 'list-heads', file)).trim().split('\n').map((line) => { const [hash, ref] = line.split(' '); return [String(ref), String(hash)] as const }))
    if (JSON.stringify(Object.entries(advertised).sort()) !== JSON.stringify(declared.sort())) throw new Error('bundle ref manifest differs from captured refs')
    await git('-c', 'fetch.fsckObjects=true', 'bundle', 'unbundle', file)
    await git('fsck', '--full', '--strict', '--no-reflogs')
    const results: Record<string, string> = {}
    for (const [ref, hash] of declared) {
      await git('cat-file', '-e', `${hash}^{commit}`)
      const key = createHash('sha256').update(ref).digest('hex').slice(0, 24)
      results[`refs/heads/dsh/${workspaceId}/${key}/turn-${turn}`] = hash
    }
    await workspaceGit(source, ['-c', 'fetch.fsckObjects=true', 'bundle', 'unbundle', file], limits)
    const existing = Object.fromEntries(text(await workspaceGit(source, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/heads/dsh/${workspaceId}/`], limits)).trim().split('\n').filter(Boolean).map((line) => { const [ref, hash] = line.split(' '); return [String(ref), String(hash)] as const }))
    const commands = ['start']
    for (const [ref, hash] of Object.entries(results)) {
      if (existing[ref] === hash) continue
      if (existing[ref] !== undefined) throw new Error('workspace return ref was changed externally; result remains pending')
      commands.push(`create ${ref} ${hash}`)
    }
    commands.push('prepare', 'commit', '')
    await workspaceGit(source, ['update-ref', '--stdin'], limits, Buffer.from(commands.join('\n')))
    return results
  } finally { await rm(staging, { recursive: true, force: true }) }
}
