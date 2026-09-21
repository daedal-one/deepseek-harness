/** Isolated preview origins and one-use authentication grants for guest-local HTTP services. @module */
import { Agent, createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { PassThrough, type Duplex } from 'node:stream'
import { getDomain } from 'tldts'

/** Preview listener and deployment origin policy. */
export interface PreviewConfig {
  /** Loopback listener port; zero requests an OS allocation for tests. */
  port: number
  /** HTTPS wildcard origin with `{id}` in its hostname; localhost HTTP is test-only. */
  originTemplate: string
  /** Harness origin, which must use a separate cookie domain. */
  controlOrigin: string
  /** Absolute grant lifetime, including open WebSockets. */
  grantLifetimeMs: number
  /** Maximum live grants. */
  maxGrants: number
  /** Maximum simultaneous accepted sockets. */
  maxConnections: number
  /** Idle HTTP or WebSocket timeout. */
  idleTimeoutMs: number
}
interface Grant {
  host: string
  origin: string
  login: Buffer | undefined
  cookie: Buffer
  connect: () => Promise<Duplex>
  expires: number
}
const COOKIE = '__Host-dsh-preview'
const LOCAL_COOKIE = 'dsh-preview-local'
const hash = (value: string): Buffer => createHash('sha256').update(value).digest()
const matches = (value: string, expected: Buffer): boolean => timingSafeEqual(hash(value), expected)

/** A dedicated loopback listener; no Harness route or credential is forwarded to guest content. */
export class VmPreviewServer {
  private disposed = false
  private disposal: Promise<void> | undefined
  private readonly connections = new Set<Promise<void>>()
  private readonly requests = new Set<ReturnType<typeof httpRequest>>()
  private readonly grants = new Map<string, Grant>()
  private readonly sockets = new Set<Duplex>()
  private readonly server = createServer((req, res) => {
    void this.handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(502); res.end() })
  })
  private timer: NodeJS.Timeout | undefined
  constructor(private readonly config: PreviewConfig) {
    const template = new URL(config.originTemplate.replace('{id}', 'example'))
    const control = new URL(config.controlOrigin)
    if (!config.originTemplate.includes('{id}.') || template.pathname !== '/' || template.search || template.hash || template.username || template.password
      || (template.protocol !== 'https:' && !(template.protocol === 'http:' && template.hostname.endsWith('.localhost') && control.hostname === '127.0.0.1'))
      || template.hostname === control.hostname
      || (getDomain(template.hostname, { allowPrivateDomains: true }) !== null
        && getDomain(template.hostname, { allowPrivateDomains: true }) === getDomain(control.hostname, { allowPrivateDomains: true }))) throw new Error('development-preview: preview and Harness require separate cookie domains and HTTPS')
    for (const value of [config.grantLifetimeMs, config.maxGrants, config.maxConnections, config.idleTimeoutMs]) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error('development-preview: invalid resource bound')
    }
    this.server.on('connection', (socket) => {
      if (this.sockets.size >= config.maxConnections) { socket.destroy(); return }
      this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); socket.setTimeout(config.idleTimeoutMs, () => socket.destroy())
    })
    this.server.on('upgrade', (req, socket, head) => {
      const grant = this.authorized(req)
      if (grant === undefined || req.headers.origin !== grant.origin) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return }
      let upstream: ReturnType<typeof httpRequest>
      try { upstream = this.proxy(req, grant) } catch { socket.destroy(); return }
      upstream.on('error', () => socket.destroy())
      upstream.on('response', () => { upstream.destroy(); socket.destroy() })
      upstream.on('upgrade', (response, remote, remoteHead) => {
        socket.write(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ''}\r\n`)
        for (const [key, value] of Object.entries(this.responseHeaders(response.headers))) {
          for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) socket.write(`${key}: ${item}\r\n`)
        }
        socket.write('\r\n'); if (remoteHead.length) socket.write(remoteHead)
        if (head.length) remote.write(head)
        remote.pipe(socket); socket.pipe(remote)
        socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy())
        const expiry = setTimeout(() => { remote.destroy(); socket.destroy() }, Math.max(1, grant.expires - Date.now()))
        socket.on('close', () =>{  clearTimeout(expiry) })
      })
      upstream.end()
    })
  }

  /** Bind the separate preview listener.
   * @returns actual loopback port.
   */
  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, '127.0.0.1', () => { this.server.off('error', reject); resolve() })
    })
    this.timer = setInterval(() =>{  this.expire() }, Math.min(this.config.grantLifetimeMs, this.config.idleTimeoutMs)); this.timer.unref()
    const address = this.server.address()
    if (address === null || typeof address === 'string') throw new Error('development-preview: listener has no TCP address')
    return address.port
  }

  /** Issue a one-use browser URL after the caller authenticates and resolves a live conversation.
   * @param connect - closure fixed to the conversation's guest and one validated port.
   * @returns URL containing a fragment credential, never a query credential.
   */
  issue(connect: () => Promise<Duplex>): string {
    if (this.disposed) throw new Error('development-preview: listener is closed')
    this.expire()
    if (this.grants.size >= this.config.maxGrants) throw new Error('development-preview: live grant limit reached')
    const id = randomBytes(16).toString('hex'); const token = randomBytes(32).toString('base64url')
    const url = new URL(this.config.originTemplate.replace('{id}', id))
    const address = this.server.address()
    if (url.port === '0' && address !== null && typeof address !== 'string') url.port = String(address.port)
    this.grants.set(url.host, { host: url.host, origin: url.origin, login: hash(token), cookie: hash(randomBytes(32).toString('hex')), connect, expires: Date.now() + this.config.grantLifetimeMs })
    url.hash = token
    return url.href
  }

  /** Revoke all grants and close HTTP, upgraded, and guest tunnel sockets. */
  async dispose(): Promise<void> { await (this.disposal ??= this.finishDispose()) }

  private async finishDispose(): Promise<void> {
    this.disposed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    for (const request of this.requests) request.destroy()
    this.grants.clear()
    await Promise.all([...this.connections])
    await Promise.all([...this.sockets].map(closeSocket))
    await new Promise<void>((resolve, reject) => this.server.close((error) =>{  if (error === undefined) resolve(); else reject(error) }))
  }

  private expire(): void { for (const [key, grant] of this.grants) if (grant.expires <= Date.now()) this.grants.delete(key) }
  private grant(req: IncomingMessage): Grant | undefined {
    const value = this.grants.get(req.headers.host ?? '')
    return value !== undefined && value.expires > Date.now() ? value : undefined
  }
  private cookieName(grant: Grant): string { return grant.origin.startsWith('https:') ? COOKIE : LOCAL_COOKIE }
  private authorized(req: IncomingMessage): Grant | undefined {
    const grant = this.grant(req)
    if (grant === undefined) return undefined
    const name = `${this.cookieName(grant)}=`
    const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(name))?.slice(name.length)
    return cookie !== undefined && matches(cookie, grant.cookie) ? grant : undefined
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const grant = this.grant(req)
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store')
    if (grant === undefined) { res.writeHead(404).end(); return }
    if (req.url === '/.dsh/authorize' && req.method === 'POST') {
      if (req.headers.origin !== grant.origin) { res.writeHead(403).end(); return }
      let token = ''
      for await (const part of req) { token += String(part); if (token.length > 128) { res.writeHead(413).end(); return } }
      if (grant.login === undefined || grant.expires <= Date.now() || !matches(token, grant.login)) { res.writeHead(403).end(); return }
      const cookie = randomBytes(32).toString('base64url'); grant.cookie = hash(cookie); grant.login = undefined
      res.setHeader('Set-Cookie', `${this.cookieName(grant)}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1, Math.floor((grant.expires - Date.now()) / 1000))}${grant.origin.startsWith('https:') ? '; Secure' : ''}`)
      res.writeHead(204).end(); return
    }
    if (this.authorized(req) === undefined) {
      if (req.url !== '/' || req.method !== 'GET' || grant.login === undefined) { res.writeHead(401).end(); return }
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
      res.end('<!doctype html><script>const token=location.hash.slice(1);history.replaceState(null,"","/");fetch("/.dsh/authorize",{method:"POST",body:token}).then(r=>{if(r.ok)location.reload()})</script>'); return
    }
    const upstream = this.proxy(req, grant)
    upstream.on('response', (response) => { res.writeHead(response.statusCode ?? 502, this.responseHeaders(response.headers)); response.pipe(res) })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
  private proxy(req: IncomingMessage, grant: Grant): ReturnType<typeof httpRequest> {
    if (this.disposed || this.requests.size >= this.config.maxConnections) throw new Error('development-preview: connection limit reached')
    const headers: IncomingMessage['headers'] = { ...req.headers, host: 'localhost', cookie: req.headers.cookie?.split(';').filter(part => !part.trim().startsWith(`${this.cookieName(grant)}=`)).join(';') }
    delete headers['proxy-authorization']; delete headers['proxy-connection']
    const sockets = this.sockets
    const agent = new Agent({ keepAlive: false, maxSockets: 1 })
    agent.createConnection = (_options, connected) => {
      if (connected === undefined) throw new Error('development-preview: missing connection callback')
      const connection = grant.connect().then(async (socket) => {
        socket.on('error', error => upstream.destroy(error))
        if (this.disposed || upstream.destroyed || grant.expires <= Date.now()) { await closeSocket(socket); return }
        sockets.add(socket); socket.on('close', () => sockets.delete(socket)); connected(null, socket)
      }, (error: unknown) => {
        const closed = new PassThrough(); closed.destroy()
        connected(error instanceof Error ? error : new Error('preview connection failed'), closed)
      })
      this.connections.add(connection)
      void connection.finally(() => this.connections.delete(connection)).catch((error: unknown) => upstream.destroy(error instanceof Error ? error : new Error('preview connection failed')))
      return undefined
    }
    const upstream = httpRequest({ method: req.method, path: req.url, headers, agent })
    this.requests.add(upstream)
    const expiry = setTimeout(() => upstream.destroy(new Error('development-preview: grant expired')), Math.max(1, grant.expires - Date.now()))
    upstream.on('close', () => { clearTimeout(expiry); this.requests.delete(upstream); agent.destroy() })
    return upstream
  }

  private responseHeaders(headers: IncomingMessage['headers']): IncomingMessage['headers'] {
    const result = { ...headers, 'referrer-policy': 'no-referrer' }
    if (result['set-cookie'] !== undefined) result['set-cookie'] = result['set-cookie'].filter(value => !value.trimStart().startsWith(`${COOKIE}=`) && !value.trimStart().startsWith(`${LOCAL_COOKIE}=`)).map(value => value.split(';').filter(part => !/^\s*domain=/iu.test(part)).join(';'))
    return result
  }
}

async function closeSocket(socket: Duplex): Promise<void> {
  if (socket.closed) return
  await new Promise<void>((resolve) => { socket.once('close', resolve); socket.destroy() })
}
