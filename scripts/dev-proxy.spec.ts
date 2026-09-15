/** Isolated process and transport regressions for the local recovery tool. */
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRecoveryProxy } from './dev-proxy.ts'
import { LocalBackends } from './dev-proxy-runtime.ts'
import type { RecoveryConfig, RecoveryControls } from './dev-proxy-runtime.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const token = 'a'.repeat(64)
const auth = { Authorization: `Bearer ${token}` }

function config(root: string): RecoveryConfig {
  return { repository: join(root, 'repo'), home: join(root, 'home'), state: join(root, 'state'),
    node: process.execPath, pnpm: join(root, 'pm'), path: process.env.PATH ?? '', port: 0, backendPort: 0,
    trustedHosts: ['example.test'], startupTimeoutMs: 5_000, stopTimeoutMs: 100 }
}

async function rootDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-recovery-')))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

async function listen(proxy: ReturnType<typeof createRecoveryProxy>): Promise<string> {
  cleanups.push(() => proxy.close())
  proxy.server.listen(0, '127.0.0.1')
  await once(proxy.server, 'listening')
  const address = proxy.server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture listener')
  return `http://127.0.0.1:${address.port}`
}

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
  } })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

async function repository(): Promise<RecoveryConfig> {
  const root = await rootDirectory()
  const options = config(root)
  for (const path of [options.state, options.home, ...['apps', 'packages', 'vendor', 'native'].map(name => join(options.repository, name))]) {
    await mkdir(path, { recursive: true })
    await writeFile(join(path, '.keep'), '')
  }
  await writeFile(join(options.repository, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(options.repository, '.gitignore'), 'lib/\nnode_modules/\n')
  await writeFile(join(options.repository, 'backend.mjs'), `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const server = createServer((req, res) => {
  if (req.url === '/edit' && req.method === 'POST') writeFileSync(process.env.DSH_HOME + '/edited.txt', 'edited by retained code\\n');
  res.end(JSON.stringify({ pid: process.pid, version: 'good', url: req.url, host: req.headers.host }));
});
server.listen(port, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:' + server.address().port + '/?token=fixture'));
`)
  // The miniature repository exercises the real supervisor without building the entire monorepo per test.
  await writeFile(options.pnpm, `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === 'run') {
  fs.mkdirSync('apps/cli/lib', { recursive: true });
  fs.copyFileSync('backend.mjs', 'apps/cli/lib/bin.js');
} else {
  fs.mkdirSync('node_modules', { recursive: true });
  fs.writeFileSync('node_modules/installation', process.cwd());
}
`)
  await chmod(options.pnpm, 0o700)
  git(options.repository, ['init', '-q'])
  git(options.repository, ['add', '.'])
  git(options.repository, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  return options
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

describe.skipIf(process.platform === 'win32')('local backend retention', () => {
  it('recovers code editing after current fails and retains the explicit selection across restarts', async () => {
    const options = await repository()
    const owner = await LocalBackends.open(options)
    const proxy = createRecoveryProxy(options, token, owner)
    const url = await listen(proxy)
    await owner.use('current')
    const first = await fetch(url).then(response => response.json()) as { pid: number }
    expect(owner.status().commit).toBe(git(options.repository, ['rev-parse', 'HEAD']))
    await fetch(`${url}/edit`, { method: 'POST' })
    await owner.markGood()
    const good = JSON.parse(await readFile(join(options.state, 'good.json'), 'utf8')) as { directory: string; commit: string }
    expect(await readFile(join(good.directory, 'node_modules/installation'), 'utf8')).toBe(good.directory)
    await writeFile(join(options.repository, 'backend.mjs'), 'throw new Error("broken current");\n')
    await expect(owner.use('current')).rejects.toThrow('exited')
    expect(alive(first.pid)).toBe(false)
    expect((await fetch(url)).status).toBe(503)
    expect((await fetch(`${url}/_dev`, { headers: auth })).status).toBe(200)
    const switched = await fetch(`${url}/_dev/use-good`, { method: 'POST', headers: auth, redirect: 'manual' })
    expect(switched.status).toBe(303)
    await expect.poll(() => owner.status().active).toBe('good')
    const restored = await fetch(`${url}/edit`, { method: 'POST' }).then(response => response.json()) as { version: string; pid: number }
    expect(restored.version).toBe('good')
    expect(await readFile(join(options.home, 'edited.txt'), 'utf8')).toBe('edited by retained code\n')
    expect((await LocalBackends.open(options)).initialTarget()).toBe('good')
    await owner.close()
    expect(alive(restored.pid)).toBe(false)
    expect(owner.status().running).toBe(false)
  })

  it('refuses dirty or rebuilt provenance and preserves a prior good record when preparation fails', async () => {
    const options = await repository()
    const owner = await LocalBackends.open(options)
    cleanups.push(() => owner.close())
    await expect(owner.use('good')).rejects.toThrow('No last-good')
    await owner.use('current')
    await owner.markGood()
    const saved = await readFile(join(options.state, 'good.json'), 'utf8')
    await writeFile(join(options.repository, 'changed.txt'), 'new change')
    await expect(owner.markGood()).rejects.toThrow('checkout changed')
    git(options.repository, ['add', 'changed.txt'])
    git(options.repository, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'next'])
    await owner.use('current')
    await writeFile(join(options.repository, 'apps/cli/lib/bin.js'), '// rebuilt differently\n')
    await expect(owner.markGood()).rejects.toThrow('artifacts changed')
    await owner.use('current')
    await writeFile(options.pnpm, `#!${process.execPath}\nprocess.exit(7);\n`)
    await expect(owner.markGood()).rejects.toThrow('exited')
    expect(await readFile(join(options.state, 'good.json'), 'utf8')).toBe(saved)
    await writeFile(join(options.repository, 'uncommitted.txt'), 'dirty')
    await writeFile(options.pnpm, `#!${process.execPath}\nprocess.exit(0);\n`)
    await owner.use('current')
    expect(owner.status().commit).toBeNull()
    await expect(owner.markGood()).rejects.toThrow('clean committed')
  })

  it('terminates a backend that never announces readiness and a child that ignores SIGTERM', async () => {
    const options = await repository()
    options.startupTimeoutMs = 500
    await writeFile(join(options.repository, 'backend.mjs'), `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.DSH_HOME + '/pid', String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`)
    const owner = await LocalBackends.open(options)
    cleanups.push(() => owner.close())
    await expect(owner.use('current')).rejects.toThrow('timed out')
    const pid = Number(await readFile(join(options.home, 'pid'), 'utf8'))
    expect(alive(pid)).toBe(false)
  })

  it('lets manual fallback interrupt a build that has stopped making progress', async () => {
    const options = await repository()
    const owner = await LocalBackends.open(options)
    const proxy = createRecoveryProxy(options, token, owner)
    const url = await listen(proxy)
    await owner.use('current')
    await owner.markGood()
    await writeFile(options.pnpm, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.DSH_HOME + '/build-pid', String(process.pid));\nsetInterval(() => {}, 1000);\n`)
    proxy.run('use-current', () => owner.use('current'))
    await expect.poll(() => readFile(join(options.home, 'build-pid'), 'utf8').catch(() => '')).not.toBe('')
    const pid = Number(await readFile(join(options.home, 'build-pid'), 'utf8'))
    const response = await fetch(`${url}/_dev/use-good`, { method: 'POST', headers: auth, redirect: 'manual' })
    expect(response.status).toBe(303)
    await expect.poll(() => owner.status().active).toBe('good')
    expect(alive(pid)).toBe(false)
    expect((await fetch(url)).status).toBe(200)
  })
})

describe('recovery proxy transport', () => {
  async function fixture() {
    const upstream = createServer((req, res) => {
      res.writeHead(201, { 'Content-Type': 'text/plain', 'Set-Cookie': 'application=preserved; HttpOnly' })
      if (req.url === '/stream') { res.write('first'); pendingEnd = () => res.end('last'); return }
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => res.end(JSON.stringify({ body, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie })))
    })
    let pendingEnd: (() => void) | undefined
    upstream.on('upgrade', (_req, socket, head) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      if (head.length > 0) socket.write(head)
      socket.pipe(socket)
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => new Promise<void>((resolveClose, reject) => upstream.close((error) => {
      if (error) reject(error)
      else resolveClose()
    })))
    const address = upstream.address()
    if (address === null || typeof address === 'string') throw new Error('Missing upstream listener')
    let marks = 0
    let switches = 0
    let releaseSwitch: (() => void) | undefined
    const controls: RecoveryControls = {
      status: () => ({ active: 'current', running: true, commit: 'a'.repeat(40), goodCommit: null, error: null }),
      openPath: () => '/?token=private-backend-token', targetPort: () => address.port,
      use: () => { switches++; return new Promise<void>((resolveSwitch) => { releaseSwitch = resolveSwitch }) },
      markGood: async () => { marks++ }, close: async () => { releaseSwitch?.() }, interrupt: async () => { releaseSwitch?.() },
    }
    const proxy = createRecoveryProxy(config('/unused'), token, controls)
    const url = await listen(proxy)
    return { url, end: () => pendingEnd?.(), marks: () => marks, switches: () => switches, release: () => releaseSwitch?.() }
  }

  it('preserves application authority, authentication, status, request bodies, and incremental responses', async () => {
    const f = await fixture()
    const response = await fetch(`${f.url}/echo`, { method: 'POST', headers: { Origin: f.url, Cookie: 'application=secret' }, body: 'one edit' })
    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toBe('application=preserved; HttpOnly')
    expect(await response.json()).toEqual({ body: 'one edit', host: new URL(f.url).host, origin: f.url, cookie: 'application=secret' })
    const streamed = await fetch(`${f.url}/stream`)
    const reader = streamed.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
    f.end()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('last')
    expect((await reader.read()).done).toBe(true)
  })

  it('authenticates recovery independently and requires explicit code-edit confirmation', async () => {
    const f = await fixture()
    expect((await fetch(`${f.url}/_dev`)).status).toBe(401)
    expect((await fetch(`${f.url}/_dev`, { headers: { ...auth, Origin: 'http://evil.test' } })).status).toBe(403)
    expect((await fetch(`${f.url}/_dev/use-good`, { method: 'POST', headers: { ...auth, Origin: 'null' } })).status).toBe(403)
    const rejectedHost = await new Promise<number | undefined>((resolveStatus, reject) => {
      const req = request(`${f.url}/_dev`, { headers: { ...auth, Host: 'evil.test' } }, (response) => {
        response.resume()
        response.on('end', () => { resolveStatus(response.statusCode) })
      })
      req.on('error', reject)
      req.end()
    })
    expect(rejectedHost).toBe(403)
    expect((await fetch(`${f.url}/_dev/use-good`, { headers: auth })).status).toBe(405)
    expect((await fetch(`${f.url}/_dev/mark-good`, { method: 'POST', headers: auth })).status).toBe(400)
    const login = await fetch(`${f.url}/_dev?token=${token}`, { redirect: 'manual' })
    expect(login.status).toBe(303)
    expect(login.headers.get('location')).toBe('/_dev')
    expect(login.headers.get('referrer-policy')).toBe('no-referrer')
    expect(login.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/_dev')
    const recovery = await fetch(`${f.url}/_dev`, { headers: { Cookie: `dsh-dev-control=${token}` } })
    expect(recovery.headers.get('referrer-policy')).toBe('same-origin')
    const page = await recovery.text()
    expect(page).toContain('I used this running version to edit code successfully.')
    expect(page).not.toContain(token)
    await expect(page).toMatchFileSnapshot(join(import.meta.dirname, 'tests/expected/dev-recovery.html'))
    const open = await fetch(`${f.url}/_dev/open`, { headers: auth, redirect: 'manual' })
    expect(open.headers.get('location')).toBe('/?token=private-backend-token')
    expect(open.headers.get('referrer-policy')).toBe('no-referrer')
    await fetch(`${f.url}/_dev/mark-good`, { method: 'POST', headers: auth, body: 'edited=yes', redirect: 'manual' })
    await expect.poll(f.marks).toBe(1)
    await fetch(`${f.url}/_dev/use-good`, { method: 'POST', headers: auth, redirect: 'manual' })
    expect((await fetch(`${f.url}/_dev/use-current`, { method: 'POST', headers: auth })).status).toBe(409)
    expect(f.switches()).toBe(1)
    expect((await fetch(f.url)).status).toBe(503)
    f.release()
  })

  it('forwards WebSocket upgrade headers and initial bytes, and closes the tunnel on switching', async () => {
    const f = await fixture()
    const socket = connect(Number(new URL(f.url).port), '127.0.0.1')
    cleanups.push(async () => { if (!socket.destroyed) { socket.destroy(); await once(socket, 'close') } })
    await once(socket, 'connect')
    let output = ''
    socket.on('data', (chunk) => { output += String(chunk) })
    socket.write(`GET /stream HTTP/1.1\r\nHost: ${new URL(f.url).host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\ninitial`)
    await expect.poll(() => output).toContain('101 Switching Protocols')
    await expect.poll(() => output).toContain('initial')
    socket.write('later')
    await expect.poll(() => output).toContain('later')
    const closed = once(socket, 'close')
    await fetch(`${f.url}/_dev/use-good`, { method: 'POST', headers: auth, redirect: 'manual' })
    await closed
    f.release()
  })
})
