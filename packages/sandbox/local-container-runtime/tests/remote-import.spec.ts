import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { cloneEnvironmentRepository } from '../src/remote-import.ts'
import { workspaceGit } from '../src/workspace-git.ts'
import type { WorkspaceLimits } from '../src/workspace-git.ts'
import type { LocalContainerRuntime } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-remote-import-')); roots.push(root)
  const limits: WorkspaceLimits = { gitCommand: '/usr/bin/git', resourceLimitCommand: '/usr/bin/prlimit', gitMemoryBytes: 268435456,
    maxBytes: 1048576, maxEntries: 1000, timeoutMs: 10000, authorName: 'Fixture', authorEmail: 'fixture@example.com' }
  const source = join(root, 'original'); await mkdir(source)
  const git = async (...args: string[]) => workspaceGit(source, args, limits)
  await git('init', '--template=', '--initial-branch=main')
  await writeFile(join(source, 'README.md'), 'remote content\n'); await git('add', '.'); await git('commit', '-m', 'initial')
  const response = { head: (await git('rev-parse', 'HEAD')).toString().trim(), branch: 'main', bundle: (await git('bundle', 'create', '-', 'HEAD')).toString('base64') }
  const repository = { source: join(root, 'managed', 'repository'), url: 'https://new.example/team/repo.git', credentialTimeoutMs: 1000 }
  const stream = new PassThrough()
  const terminate = vi.fn(async () => { stream.destroy() })
  const createProcess = vi.fn(async () => ({ stream, done: Promise.resolve({ exitCode: 0 }), terminate }))
  const runtime = { createProcess } as unknown as LocalContainerRuntime
  return { root, limits, repository, response, stream, terminate, createProcess, runtime }
}

it.skipIf(process.platform === 'win32')('verifies the sandbox bundle and publishes a reusable environment-owned checkout without credentials', async () => {
  const f = await fixture(); f.stream.end(JSON.stringify(f.response))
  await cloneEnvironmentRepository(f.runtime, f.repository, f.limits, 2097152, new AbortController().signal)
  expect(await readFile(join(f.repository.source, 'README.md'), 'utf8')).toBe('remote content\n')
  expect((await workspaceGit(f.repository.source, ['rev-parse', 'HEAD'], f.limits)).toString().trim()).toBe(f.response.head)
  const config = await readFile(join(f.repository.source, '.git/config'), 'utf8')
  expect(config).toContain(f.repository.url); expect(config).not.toMatch(/credential|extraHeader/u)
  await cloneEnvironmentRepository(f.runtime, f.repository, f.limits, 2097152, new AbortController().signal)
  expect(f.createProcess).toHaveBeenCalledTimes(1); expect(f.terminate).toHaveBeenCalledTimes(1)
})

it.skipIf(process.platform === 'win32')('rejects a mismatched starting revision without publishing a destination', async () => {
  const f = await fixture(); f.stream.end(JSON.stringify({ ...f.response, head: 'a'.repeat(40) }))
  await expect(cloneEnvironmentRepository(f.runtime, f.repository, f.limits, 2097152, new AbortController().signal)).rejects.toThrow('starting revision')
  expect(await readdir(join(f.root, 'managed'))).toEqual([])
  expect(f.terminate).toHaveBeenCalledTimes(1)
})

it.skipIf(process.platform === 'win32')('terminates a clone when cancellation arrives while its output stream is idle', async () => {
  const f = await fixture(); const controller = new AbortController()
  let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  f.createProcess.mockImplementationOnce(async () => {
    entered(); return { stream: f.stream, done: Promise.resolve({ exitCode: 0 }), terminate: f.terminate }
  })
  const operation = cloneEnvironmentRepository(f.runtime, f.repository, f.limits, 2097152, controller.signal)
  const rejected = expect(operation).rejects.toThrow()
  await ready; controller.abort(); await rejected
  expect(f.terminate).toHaveBeenCalledTimes(1)
  expect(await readdir(f.root)).toEqual(['original'])
})

it.skipIf(process.platform === 'win32')('terminates oversized output before writing host repository data', async () => {
  const f = await fixture(); f.stream.end('x'.repeat(1025))
  await expect(cloneEnvironmentRepository(f.runtime, f.repository, f.limits, 1024, new AbortController().signal)).rejects.toThrow('response exceeds')
  expect(f.terminate).toHaveBeenCalledTimes(1)
  expect(await readdir(f.root)).toEqual(['original'])
})
