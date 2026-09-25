import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { VmPreviewServer, type PreviewConfig } from '../src/vm-preview-server.ts'

const config: PreviewConfig = { port: 0, originTemplate: 'http://{id}.localhost:0', controlOrigin: 'http://127.0.0.1:3080', grantLifetimeMs: 60000, maxGrants: 8, maxConnections: 16, idleTimeoutMs: 10000 }
const disposers: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

async function fixture(connecting?: (socket: Duplex) => Promise<Duplex>) {
  const requests: string[] = []
  const guest = createServer((req, res) => {
    requests.push(req.headers.cookie ?? '')
    res.setHeader('Set-Cookie', ['app=value; Domain=example.net', 'dsh-preview-local=forged; Path=/'])
    res.end('guest application')
  })
  guest.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.on('data', (bytes) => { socket.write(bytes); socket.end() })
  })
  await new Promise<void>((resolve, reject) => { guest.once('error', reject); guest.listen(0, '127.0.0.1', resolve) })
  disposers.push(async () => {
    guest.closeAllConnections()
    await new Promise<void>((resolve, reject) => guest.close((error) => { if (error) reject(error); else resolve() }))
  })
  const address = guest.address()
  if (address === null || typeof address === 'string') throw new Error('missing guest listener')
  const previews = new VmPreviewServer(config)
  const port = await previews.listen()
  disposers.push(() => previews.dispose())
  let connections = 0
  const url = new URL(previews.issue(async () => { connections++; const socket = connect(address.port, '127.0.0.1'); const stream = Duplex.from({ readable: socket, writable: socket }); return connecting === undefined ? stream : await connecting(stream) }))
  const send = async (path: string, method = 'GET', headers: Record<string, string> = {}, body = '') => await new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: { Host: url.host, ...headers } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += String(chunk) }); res.on('end', () =>{  resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }) })
    }); req.on('error', reject); req.end(body)
  })
  const login = async () => {
    const result = await send('/.dsh/authorize', 'POST', { Origin: url.origin }, url.hash.slice(1))
    expect(result.status).toBe(204)
    return result.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
  }
  return { url, port, send, login, requests, connections: () => connections, dispose: () => previews.dispose() }
}

describe('isolated development previews', () => {
  it('requires separate cookie domains and rejects insecure remote origins', () => {
    expect(() => new VmPreviewServer({ ...config, originTemplate: 'https://{id}.preview.example.com', controlOrigin: 'https://app.example.com' })).toThrow('cookie domains')
    expect(() => new VmPreviewServer({ ...config, originTemplate: 'http://{id}.example.net' })).toThrow('HTTPS')
  })
  it('authenticates once, keeps the grant out of guest headers, and confines application cookies', async () => {
    const test = await fixture()
    expect((await test.send('/private')).status).toBe(401)
    expect(test.connections()).toBe(0)
    expect((await test.send('/.dsh/authorize', 'POST', { Origin: 'https://attacker.example' }, test.url.hash.slice(1))).status).toBe(403)
    const cookie = await test.login()
    const response = await test.send('/', 'GET', { Cookie: `${cookie}; app=session` })
    expect(response.status).toBe(200); expect(response.body).toBe('guest application')
    expect(test.requests).toEqual(['app=session'])
    expect(response.headers['set-cookie']).toEqual(['app=value'])
    expect((await test.send('/.dsh/authorize', 'POST', { Origin: test.url.origin }, test.url.hash.slice(1))).status).toBe(403)
    expect((await test.send('/', 'GET', { Host: 'different.localhost', Cookie: cookie })).status).toBe(404)
  })
  it('authenticates WebSocket upgrades and relays their bytes through the guest connector', async () => {
    const test = await fixture(); const cookie = await test.login()
    const echo = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: test.port, headers: { Host: test.url.host, Origin: test.url.origin, Cookie: cookie, Connection: 'Upgrade', Upgrade: 'websocket' } })
      req.on('error', reject)
      req.on('response', (res) => { res.resume(); reject(new Error(`unexpected HTTP ${res.statusCode}`)) })
      req.on('upgrade', (_res, socket, head) => {
        if (head.length) { socket.destroy(); reject(new Error('unexpected upgrade bytes')); return }
        socket.on('error', reject); socket.once('data', (bytes) => { socket.destroy(); resolve(bytes.toString()) }); socket.write('echo')
      }); req.end()
    })
    expect(echo).toBe('echo')
    expect(test.connections()).toBe(1)
  })
  it('waits for a pending guest tunnel and closes it before disposal completes', async () => {
    const started = Promise.withResolvers<Duplex>()
    const release = Promise.withResolvers<undefined>()
    const test = await fixture(async (socket) => { started.resolve(socket); await release.promise; return socket })
    const cookie = await test.login()
    const request = test.send('/', 'GET', { Cookie: cookie }).catch((error: unknown) => error)
    const socket = await started.promise
    let disposed = false
    const disposal = test.dispose().then(() => { disposed = true })
    try {
      await Promise.resolve()
      expect(disposed).toBe(false)
    } finally { release.resolve(undefined) }
    await disposal; await request
    expect(socket.closed).toBe(true)
    await test.dispose()
  })

})
