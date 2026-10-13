import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection, Server, Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Packet } from '../src/contract.ts'
import { openBridge } from '../src/bridge.ts'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const packet: Packet = { schema: 'forge-intellect-verification-agent/v1', role: 'assessor', stage: 'plan', context: { obligations: [], sources: {} }, response_contract: {} }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'intellect-bridge-'))
  roots.push(root)
  const directory = join(root, 'agents/assessor/plan')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'request.json'), JSON.stringify(packet))
  return { root, directory }
}
function client(socket: string, directory: string, input: object) {
  const process = spawn(globalThis.process.execPath, [fileURLToPath(new URL('../runtime/bridge.mjs', import.meta.url)), socket], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] })
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = '', stderr = ''
    process.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
    process.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })
    process.once('error', reject)
    process.once('close', (code) =>{  resolve({ code, stdout, stderr }) })
  })
  process.stdin.end(JSON.stringify(input))
  return { process, done }
}
function exchange(path: string, bytes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let result = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { result += chunk })
    socket.once('error', reject)
    socket.once('end', () => { resolve(result) })
    socket.once('connect', () => { socket.end(bytes) })
  })
}
describe.skipIf(process.platform === 'win32')('private native reviewer transport', () => {
  it('transfers only the retained native packet, rejects duplicate and forged calls, and removes its socket', async () => {
    const { root, directory } = await fixture()
    const broker = await openBridge(root, new AbortController().signal, async received => ({ schema: received.schema, fixture: 'reviewed' }))
    try {
      const forged = client(broker.path, directory, { ...packet, role: 'challenger' })
      expect((await forged.done).code).not.toBe(0)
      const result = await client(broker.path, directory, packet).done
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ fixture: 'reviewed' })
      expect((await client(broker.path, directory, packet).done).code).not.toBe(0)
    } finally { await broker.close() }
    await expect(readFile(broker.path)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)
  it('cancels and awaits the active reviewer when its transport goes away', async () => {
    const { root, directory } = await fixture()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let stopped = false
    const broker = await openBridge(root, new AbortController().signal, async (_packet, _directory, signal) => {
      started()
      await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { stopped = true; resolve() }, { once: true }) })
      throw new Error('cancelled')
    })
    const running = client(broker.path, directory, packet)
    try {
      await ready
      running.process.kill()
      await running.done
    } finally {
      running.process.kill()
      await running.done
      await broker.close()
    }
    expect(stopped).toBe(true)
  }, 15000)
  it('rejects foreign evidence, altered input, oversized packets and oversized responses', async () => {
    const { root, directory } = await fixture()
    let calls = 0
    const broker = await openBridge(root, new AbortController().signal, async () => { calls++; return 'x'.repeat(2 * 1024 * 1024) })
    try {
      const request = (selected: string, input = packet) => JSON.stringify({ directory: selected, packet: input })
      expect(JSON.parse(await exchange(broker.path, request(root)))).toMatchObject({ error: 'Reviewer requested a foreign evidence directory' })
      expect(JSON.parse(await exchange(broker.path, request(directory, { ...packet, context: { ...packet.context, obligations: [{ id: 'forged' }] } })))).toMatchObject({ error: 'Reviewer packet differs from retained native input' })
      expect(JSON.parse(await exchange(broker.path, 'x'.repeat(2 * 1024 * 1024 + 1)))).toMatchObject({ error: 'Verification packet exceeds budget' })
      expect(JSON.parse(await exchange(broker.path, request(directory)))).toMatchObject({ error: 'Verification response exceeds budget' })
      expect(calls).toBe(1)
    } finally { await broker.close() }
  })
  it('refuses an already-cancelled run before creating a reviewer', async () => {
    const { root, directory } = await fixture()
    const controller = new AbortController()
    controller.abort(new Error('Run cancelled'))
    let calls = 0
    const broker = await openBridge(root, controller.signal, async () => { calls++; return {} })
    try {
      expect(JSON.parse(await exchange(broker.path, JSON.stringify({ directory, packet })))).toMatchObject({ error: 'Run cancelled' })
      expect(calls).toBe(0)
    } finally { await broker.close() }
  })

  it('closes incomplete requests and handles socket read failures without starting a reviewer', async () => {
    const listens = vi.spyOn(Server.prototype, 'listen')
    const { root } = await fixture()
    let calls = 0
    const broker = await openBridge(root, new AbortController().signal, async () => { calls++; return {} })
    const server = listens.mock.contexts[0] as Server
    try {
      for (const failure of [false, true]) {
        const accepted = Promise.withResolvers<import('node:net').Socket>()
        server.once('connection', (socket) => { accepted.resolve(socket) })
        const socket = createConnection(broker.path)
        socket.on('error', () => {})
        socket.resume()
        const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
        const peer = await accepted.promise
        if (failure) peer.emit('error', new Error('read failure'))
        else peer.destroy()
        await closed
      }
      expect(calls).toBe(0)
    } finally { await broker.close() }
  })

  it('cleans up after listener failure', async () => {
    const { root } = await fixture()
    vi.spyOn(Server.prototype, 'listen').mockImplementationOnce(function (this: Server) {
      queueMicrotask(() => { this.emit('connection', new Socket()); this.emit('error', new Error('listen refused')) })
      return this
    })
    await expect(openBridge(root, new AbortController().signal, async () => ({}))).rejects.toThrow('listen refused')
  })

  it.each([false, true])('encodes fractional identity values and non-Error reviewer failures (%s)', async (fail) => {
    const { root, directory } = await fixture()
    const broker = await openBridge(root, new AbortController().signal, async () => {
      if (fail) throw 'reviewer failure'
      return { usage: 0.5 }
    })
    try {
      expect(JSON.parse(await exchange(broker.path, JSON.stringify({ directory, packet })))).toEqual(fail ? { error: 'Reviewer failed' } : { usage: '0.5' })
    } finally { await broker.close() }
  })

  it('removes the private socket directory even if listener shutdown reports a failure', async () => {
    const { root } = await fixture()
    const listens = vi.spyOn(Server.prototype, 'listen')
    const broker = await openBridge(root, new AbortController().signal, async () => ({}))
    const server = listens.mock.contexts[0] as Server
    const close = server.close.bind(server)
    vi.spyOn(Server.prototype, 'close').mockImplementationOnce(callback => close(() => { callback?.(new Error('shutdown failure')) }))
    await expect(broker.close()).rejects.toThrow('shutdown failure')
    await expect(readFile(broker.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

})
