import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { cloneManagedRepository, preparePublication, publicationGit, publishBranch } from '../src/git-push.ts'

const exec = promisify(execFile)

test('publishes only the approved development commit through clean metadata despite malicious local Git config', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-push-test-')))
  const repositoryRoot = join(root, 'remotes')
  const bare = join(repositoryRoot, 'apps', 'atlas.git')
  const workspace = join(root, 'workspace')
  const contacts: string[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture')
    contacts.push(url.pathname)
    if (req.headers.authorization !== 'token test-repository-token') {
      res.writeHead(401); res.end(); return
    }
    if (!url.pathname.startsWith('/apps/atlas.git/')) {
      res.writeHead(404); res.end(); return
    }
    const child = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env.PATH, GIT_PROJECT_ROOT: repositoryRoot, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname, REQUEST_METHOD: req.method,
        QUERY_STRING: url.search.slice(1), CONTENT_TYPE: req.headers['content-type'] ?? '',
        REMOTE_USER: 'fixture', CONTENT_LENGTH: req.headers['content-length'] ?? '',
      }, stdio: ['pipe', 'pipe', 'ignore'],
    })
    req.pipe(child.stdin)
    let header = Buffer.alloc(0)
    let started = false
    child.stdout.on('data', (chunk: Buffer) => {
      if (started) { res.write(chunk); return }
      header = Buffer.concat([header, chunk])
      const separator = header.indexOf('\r\n\r\n')
      if (separator === -1) return
      const values: Record<string, string> = {}
      let status = 200
      for (const line of header.subarray(0, separator).toString().split('\r\n')) {
        const colon = line.indexOf(':')
        const name = line.slice(0, colon).toLowerCase()
        const value = line.slice(colon + 1).trim()
        if (name === 'status') status = Number.parseInt(value, 10)
        else values[name] = value
      }
      res.writeHead(status, values)
      res.write(header.subarray(separator + 4))
      started = true
    })
    child.once('close', () => { res.end() })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing fixture address')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const config = { forgejoBaseUrl: origin, forgejoToken: 'test-repository-token', gitPushTimeoutMs: 5000, maxRequestBytes: 1024 * 1024 }
  const git = (...args: string[]): Promise<{ stdout: string }> => exec('git', ['-C', workspace, ...args])
  try {
    await mkdir(join(repositoryRoot, 'apps'), { recursive: true })
    await exec('git', ['init', '--bare', '--initial-branch=main', bare])
    await exec('git', ['--git-dir', bare, 'config', 'http.receivepack', 'true'])
    await exec('git', ['init', '--initial-branch=main', workspace])
    await git('config', 'user.name', 'Fixture')
    await git('config', 'user.email', 'fixture@example.invalid')
    await writeFile(join(workspace, 'file.txt'), 'base\n')
    await git('add', '.')
    await git('commit', '-m', 'base')
    await git('push', bare, 'main')
    await git('remote', 'add', 'origin', `${origin}/apps/atlas.git`)
    await expect(preparePublication(workspace, 'apps/atlas', config)).rejects.toThrow(/development branch/)
    await git('checkout', '-b', 'codex/change')
    await writeFile(join(workspace, 'file.txt'), 'change\n')
    await expect(preparePublication(workspace, 'apps/atlas', config)).rejects.toThrow(/pending workspace/)
    await git('add', '.')
    await git('commit', '-m', 'change')
    const selected = await preparePublication(workspace, 'apps/atlas', config)
    const marker = join(root, 'credential-leak')
    await mkdir(join(workspace, '.git', 'hooks'), { recursive: true })
    await writeFile(join(workspace, '.git', 'hooks', 'pre-push'), `#!/bin/sh\nenv > '${marker}'\n`, { mode: 0o700 })
    await git('config', 'remote.origin.pushurl', `${origin}/attacker/other.git`)
    await git('config', `url.${origin}/attacker/.insteadOf`, `${origin}/apps/`)
    await git('config', 'credential.helper', `!env > '${marker}'`)
    await git('config', 'core.sshCommand', `env > '${marker}'`)
    expect(await publishBranch(selected, config)).toBe(selected.commit)
    expect((await exec('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/codex/change'])).stdout.trim()).toBe(selected.commit)
    expect(contacts.length).toBeGreaterThan(0)
    expect(contacts.every(path => path.startsWith('/apps/atlas.git/'))).toBe(true)
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(workspace, '.git', 'config'), 'utf8')).not.toContain(config.forgejoToken)
    const cloned = join(root, 'second-clone')
    await cloneManagedRepository(cloned, 'apps/atlas', config)
    expect(await readFile(join(cloned, 'file.txt'), 'utf8')).toBe('base\n')
    expect(await readFile(join(cloned, '.git', 'config'), 'utf8')).not.toContain(config.forgejoToken)
    await exec('git', ['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/codex/change'])
    await expect(publishBranch(selected, config)).rejects.toThrow(/default branch/)
    await exec('git', ['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
    await writeFile(join(workspace, 'file.txt'), 'another change\n')
    await git('add', '.')
    await git('commit', '-m', 'later')
    await expect(publishBranch(selected, config)).rejects.toThrow(/changed after publication approval/)
    await git('remote', 'set-url', 'origin', `${origin}/apps/other.git`)
    await expect(publishBranch(selected, config)).rejects.toThrow(/registered Forge repository/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)

test('publication processes refuse cancellation and excess output without returning Git diagnostics', async () => {
  const config = { forgejoBaseUrl: 'http://unused.invalid', forgejoToken: 'fake-unused-token', gitPushTimeoutMs: 5000, maxRequestBytes: 1 }
  await expect(publicationGit(['--version'], config)).rejects.toThrow('output exceeded its limit')
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(publicationGit(['--version'], config, {}, cancelled.signal)).rejects.toThrow('cancelled')
  await expect(publicationGit(['not-a-git-command'], { ...config, maxRequestBytes: 4096 })).rejects.toThrow(/^Git publication failed/)
})
