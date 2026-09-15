/** Independent local HTTP/WebSocket recovery proxy. Runs directly with Node 22.19+ on macOS/Linux. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { LocalBackends } from './dev-proxy-runtime.ts'
import type { RecoveryConfig, RecoveryControls } from './dev-proxy-runtime.ts'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function equalToken(value: string | undefined, expected: string): boolean {
  return value !== undefined && Buffer.byteLength(value) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}

function send(res: ServerResponse, status: number, content: string, type = 'text/html'): void {
  // HTML form navigations need their Origin header for the recovery access check.
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" })
  res.end(content)
}

/** Create the recovery listener; callers own listen, initial selection, and close.
 * @param config - loopback listener, backend port, and allowed public hostnames.
 * @param token - private capability used only for the recovery controls.
 * @param controls - backend lifecycle owner.
 * @returns listener, serialized operation dispatcher, and quiescent shutdown.
 */
export function createRecoveryProxy(config: RecoveryConfig, token: string, controls: RecoveryControls) {
  const sockets = new Set<Socket>()
  const tunnels = new Set<Duplex>()
  let operation: Promise<void> | undefined
  let operationName: string | null = null
  let lastError: string | null = null
  let closing = false
  let operationId = 0
  const hosts = new Set(['localhost', '127.0.0.1', ...config.trustedHosts])
  function allowed(req: IncomingMessage): boolean {
    try {
      const authority = new URL(`http://${req.headers.host ?? ''}`)
      if (!hosts.has(authority.hostname) || authority.username !== '' || authority.password !== '') return false
      const origin = req.headers.origin
      return origin === undefined || new URL(origin).host === authority.host
    } catch { return false }
  }
  function authenticated(req: IncomingMessage): boolean {
    const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dsh-dev-control='))?.slice(16)
    return equalToken(cookie, token) || equalToken(req.headers.authorization?.replace(/^Bearer /u, ''), token)
  }
  function run(name: string, action: () => Promise<void>): boolean {
    if (closing) return false
    const previous = operation
    if (previous !== undefined && (name !== 'use-good' || operationName === 'use-good' || controls.status().goodCommit === null)) return false
    const id = ++operationId
    operationName = name
    lastError = null
    if (name !== 'mark-good') for (const tunnel of tunnels) tunnel.destroy()
    operation = Promise.resolve().then(async () => {
      if (previous !== undefined) { await controls.interrupt(); await previous }
      await action()
    }).catch((error: unknown) => { if (id === operationId) lastError = String(error) }).finally(() => {
      if (id === operationId) { operation = undefined; operationName = null }
    })
    return true
  }
  function page(): string {
    const status = controls.status()
    const detail = escapeHtml(lastError ?? status.error ?? '')
    const button = (route: string, title: string, confirmation = ''): string => {
      const canInterrupt = route === 'use-good' && status.goodCommit !== null && operationName !== 'use-good'
      return `<form method="post" action="/_dev/${route}">${confirmation}<button${operation !== undefined && !canInterrupt ? ' disabled' : ''}>${title}</button></form>`
    }
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DSH recovery</title>${operation !== undefined ? '<meta http-equiv="refresh" content="2">' : ''}<style>body{font:16px system-ui;max-width:640px;margin:64px auto;padding:0 24px;color:#20242b;background:#f5f6f8}h1{font-size:28px}code{overflow-wrap:anywhere}form{margin:16px 0}button{font:inherit;padding:10px 16px;cursor:pointer}label{display:block;margin-bottom:12px}.error{color:#a12622;white-space:pre-wrap}a{color:#1654b8}</style><h1>DSH recovery</h1><p>Active: <strong>${escapeHtml(status.active ?? 'none')}</strong> · ${status.running ? 'running' : 'stopped'}</p><p>Running commit: <code>${escapeHtml(status.commit ?? 'uncommitted / unverified')}</code></p><p>Last good: <code>${escapeHtml(status.goodCommit ?? 'not marked')}</code></p><p>${escapeHtml(operationName ?? 'Ready')}</p><p class="error">${detail}</p>${button('use-good', 'Use last good')}${button('use-current', 'Use current')}${button('mark-good', 'Mark current good', '<label><input type="checkbox" name="edited" value="yes" required> I used this running version to edit code successfully.</label>')}<p>Switching interrupts active work. Reopen the harness after switching; tasks and file edits are not replayed or undone.</p><p><a href="/_dev/open">Open harness</a> · <a href="/_dev">Refresh status</a></p></html>\n`
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) send(res, 500, escapeHtml(String(error)))
      else res.destroy()
    })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowed(req)) { send(res, 403, 'Untrusted Host or Origin.'); return }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/_dev' || url.pathname.startsWith('/_dev/')) {
      if (req.method === 'GET' && url.pathname === '/_dev' && equalToken(url.searchParams.get('token') ?? undefined, token)) {
        res.writeHead(303, { Location: '/_dev', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
          'Set-Cookie': `dsh-dev-control=${token}; HttpOnly; SameSite=Strict; Path=/_dev` })
        res.end()
        return
      }
      if (!authenticated(req)) { send(res, 401, 'Open the private recovery URL printed at proxy startup.'); return }
      if (req.method === 'GET' && url.pathname === '/_dev/status') {
        send(res, 200, JSON.stringify({ ...controls.status(), operation: operationName, operationError: lastError }), 'application/json')
        return
      }
      if (req.method === 'GET' && url.pathname === '/_dev/open') {
        res.writeHead(303, { Location: controls.openPath(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        res.end()
        return
      }
      if (req.method === 'GET' && url.pathname === '/_dev') { send(res, 200, page()); return }
      if (req.method !== 'POST') { send(res, 405, 'Use POST for recovery actions.'); return }
      const route = url.pathname.slice('/_dev/'.length)
      if (!['use-good', 'use-current', 'mark-good'].includes(route)) { send(res, 404, 'Unknown recovery action.'); return }
      if (route === 'mark-good') {
        let body = ''
        for await (const chunk of req) {
          body += String(chunk)
          if (body.length > 1024) { send(res, 413, 'Confirmation is too large.'); return }
        }
        if (new URLSearchParams(body).get('edited') !== 'yes') {
          send(res, 400, 'Confirm an actual successful code edit with edited=yes.'); return
        }
      }
      const started = run(route, () => route === 'mark-good' ? controls.markGood() : controls.use(route === 'use-good' ? 'good' : 'current'))
      if (!started) { send(res, 409, 'A recovery operation is already running.'); return }
      res.writeHead(303, { Location: '/_dev', 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    if (!controls.status().running || operationName === 'use-current' || operationName === 'use-good') {
      send(res, 503, '<p>Harness unavailable. <a href="/_dev">Open recovery</a>.</p>'); return
    }
    // Preserve Host, Origin, cookies, status, and streaming bodies; the Harness owns API authentication.
    const upstream = request({ host: '127.0.0.1', port: controls.targetPort(), method: req.method,
      path: req.url, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.on('error', () => res.destroy())
      response.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) send(res, 502, '<p>Harness connection failed. <a href="/_dev">Open recovery</a>.</p>')
      else res.destroy()
    })
    req.on('aborted', () => upstream.destroy())
    req.on('error', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req) || req.url?.startsWith('/_dev') || !controls.status().running
      || operationName === 'use-current' || operationName === 'use-good') { socket.destroy(); return }
    const port = controls.targetPort()
    if (port === undefined) { socket.destroy(); return }
    const upstream = connect(port, '127.0.0.1')
    for (const stream of [socket, upstream]) {
      tunnels.add(stream)
      stream.once('close', () => { tunnels.delete(stream); socket.destroy(); upstream.destroy() })
      stream.on('error', () => { socket.destroy(); upstream.destroy() })
    }
    upstream.once('connect', () => {
      upstream.write(`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/${req.httpVersion}\r\n`)
      for (let i = 0; i < req.rawHeaders.length; i += 2) upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`)
      upstream.write('\r\n')
      if (head.length > 0) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
  })
  return {
    server, run,
    async close(): Promise<void> {
      closing = true
      const closed = new Promise<void>((resolveClosed, reject) => server.close((error) => {
        if (error) reject(error)
        else resolveClosed()
      }))
      for (const socket of sockets) socket.destroy()
      for (const socket of tunnels) socket.destroy()
      await controls.close()
      await operation
      await closed
    },
  }
}

async function main(): Promise<void> {
  if (process.platform === 'win32') throw new Error('The local development proxy supports macOS and Linux.')
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    state: { type: 'string', default: join(homedir(), '.local/share/dsh-dev-proxy') },
    repository: { type: 'string', default: process.cwd() }, home: { type: 'string', default: process.env.DSH_HOME ?? join(homedir(), '.dsh') },
    port: { type: 'string', default: '3080' }, 'backend-port': { type: 'string', default: '0' },
    'trusted-host': { type: 'string', multiple: true }, pnpm: { type: 'string', default: 'pnpm' },
  } })
  const state = resolve(values.state)
  const command = positionals[0]
  if (positionals.length !== 1 || command === undefined || !['install', 'serve'].includes(command)) {
    throw new Error('Usage: node scripts/dev-proxy.ts install [--state path --trusted-host hostname] | serve --state path')
  }
  if (positionals[0] === 'install') {
    const config: RecoveryConfig = { repository: resolve(values.repository), home: resolve(values.home), state,
      port: Number(values.port), backendPort: Number(values['backend-port']), trustedHosts: values['trusted-host'] ?? [],
      node: process.execPath, pnpm: values.pnpm, path: process.env.PATH ?? '', startupTimeoutMs: 60_000, stopTimeoutMs: 7_000 }
    validateConfig(config)
    await mkdir(state, { recursive: true, mode: 0o700 })
    // Refuse accidental reconfiguration of an existing installation.
    await writeFile(join(state, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await writeFile(join(state, 'token'), randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
    for (const file of ['dev-proxy.ts', 'dev-proxy-runtime.ts']) await cp(join(import.meta.dirname, file), join(state, file))
    await writeFile(join(state, 'package.json'), '{"type":"module"}\n', { mode: 0o600 })
    console.log(`Installed. Start with: ${process.execPath} ${join(state, 'dev-proxy.ts')} serve --state ${state}`)
    return
  }
  const config: unknown = JSON.parse(await readFile(join(state, 'config.json'), 'utf8'))
  validateConfig(config)
  if (config.state !== state) throw new Error('Configured state directory does not match --state.')
  const token = await readFile(join(state, 'token'), 'utf8')
  if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error('Invalid recovery token file.')
  const controls = await LocalBackends.open(config)
  const proxy = createRecoveryProxy(config, token, controls)
  await new Promise<void>((resolveListen, reject) => {
    proxy.server.once('error', reject)
    proxy.server.listen(config.port, '127.0.0.1', resolveListen)
  })
  console.log(`Recovery: http://127.0.0.1:${config.port}/_dev?token=${token}`)
  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    void proxy.close().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  const target = controls.initialTarget()
  proxy.run(`use-${target}`, () => controls.use(target))
}

/** Validate disk-owned configuration before it can select paths or spawn processes. */
function validateConfig(value: unknown): asserts value is RecoveryConfig {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid recovery configuration.')
  const fields = value as Record<string, unknown>
  for (const key of ['repository', 'home', 'state', 'node', 'pnpm', 'path']) {
    if (typeof fields[key] !== 'string' || fields[key] === '') throw new Error(`Invalid recovery configuration: ${key}.`)
  }
  for (const key of ['repository', 'home', 'state', 'node']) {
    if (resolve(String(fields[key])) !== fields[key]) throw new Error(`${key} must be absolute.`)
  }
  for (const key of ['port', 'backendPort']) {
    const port = fields[key]
    if (typeof port !== 'number' || !Number.isInteger(port) || port < (key === 'backendPort' ? 0 : 1) || port > 65535) throw new Error(`Invalid ${key}.`)
  }
  if (fields.port === fields.backendPort) throw new Error('Proxy and backend ports must differ.')
  for (const key of ['startupTimeoutMs', 'stopTimeoutMs']) {
    if (typeof fields[key] !== 'number' || !Number.isSafeInteger(fields[key]) || fields[key] < 1) throw new Error(`Invalid ${key}.`)
  }
  if (!Array.isArray(fields.trustedHosts) || fields.trustedHosts.some(host => typeof host !== 'string' || !/^[a-zA-Z0-9.-]+$/u.test(host))) {
    throw new Error('trustedHosts must contain plain hostnames or IPv4 addresses.')
  }
}

if (import.meta.main) void main().catch((error: unknown) => { console.error(String(error)); process.exitCode = 1 })
