import { request } from 'node:http'
import { expect } from 'vitest'
import { VmPreviewServer } from '../../src/vm-preview-server.ts'
import type { WorkspaceExecutionRuntime } from '../../src/types.ts'

export async function previewProbe(runtime: WorkspaceExecutionRuntime): Promise<void> {
  const previews = new VmPreviewServer({ port: 0, originTemplate: 'http://{id}.localhost:0', controlOrigin: 'http://127.0.0.1',
    grantLifetimeMs: 60000, maxGrants: 2, maxConnections: 4, idleTimeoutMs: 10000 })
  try {
    const port = await previews.listen()
    const connect = runtime.connectPreview?.bind(runtime)
    if (connect === undefined) throw new Error('VM preview connector is absent')
    const url = new URL(previews.issue(async () => await connect(8080)))
    const send = async (path: string, method = 'GET', headers: Record<string, string> = {}, body = '') => await new Promise<{
      status: number
      cookie: string
      body: string
    }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: url.host, ...headers } }, (res) => {
        let text = ''
        res.on('data', (data) => { text += String(data) })
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '', body: text }) })
      })
      req.on('error', reject); req.end(body)
    })
    expect((await send('/private')).status).toBe(401)
    const login = await send('/.dsh/authorize', 'POST', { Origin: url.origin }, url.hash.slice(1))
    expect(login.status).toBe(204)
    expect((await send('/', 'GET', { Cookie: login.cookie })).body).toContain('id="counter">1</p>')
    const echo = await new Promise<string>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/', headers: {
        Host: url.host, Origin: url.origin, Cookie: login.cookie, Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'ZHNodm1wcmV2aWV3dGVzdA==',
      } })
      req.on('error', reject)
      req.on('response', (res) => { res.resume(); reject(new Error(`unexpected upgrade response ${res.statusCode}`)) })
      req.on('upgrade', (_res, socket, head) => {
        let bytes = head
        socket.on('error', reject)
        const receive = (chunk: Buffer): void => {
          bytes = Buffer.concat([bytes, chunk])
          if (bytes.length < 2 || bytes.length < 2 + (bytes[1]! & 127)) return
          socket.destroy(); resolve(bytes.subarray(2).toString())
        }
        socket.on('data', receive)
        socket.write(Buffer.concat([Buffer.from([0x81, 0x84, 0, 0, 0, 0]), Buffer.from('echo')]))
      })
      req.end()
    })
    expect(echo).toBe('echo')
  } finally { await previews.dispose() }
}

export async function terminalProbe(runtime: WorkspaceExecutionRuntime): Promise<void> {
  const process = await runtime.createProcess({ argv: ['/bin/sh', '-c', 'printf terminal-ready; read line; stty size'],
    cwd: '/workspace', environment: { PATH: '/usr/bin:/bin', HOME: '/root', TERM: 'xterm' }, tty: true, stdin: true })
  let output = ''
  const ready = Promise.withResolvers<undefined>()
  process.stream.on('data', (data: Buffer) => { output += data.toString(); if (output.includes('terminal-ready')) ready.resolve(undefined) })
  process.stream.on('error', ready.reject)
  void process.done.then(() => { if (!output.includes('terminal-ready')) ready.reject(new Error(`terminal closed: ${output}`)) })
  try {
    await ready.promise
    await process.resize(31, 93)
    expect((await process.inspectTerminalForeground?.())?.processGroupId).toBeGreaterThan(0)
    process.stream.write('\n')
    expect((await process.done).exitCode).toBe(0)
    expect(output).toContain('31 93')
  } finally { await process.terminate() }
}
