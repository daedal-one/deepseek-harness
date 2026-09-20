import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { DockerodePodmanEngine } from '../src/engine.ts'

it.skipIf(process.platform === 'win32')('keeps a process wait alive beyond the ordinary Engine request timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wait-'))
  const socket = join(root, 'engine.sock')
  const attached = Promise.withResolvers<ServerResponse>()
  const server = createServer((request, response) => {
    expect(request.url).toBe('/containers/process/wait?condition=not-running')
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.flushHeaders()
    attached.resolve(response)
  })
  const controller = new AbortController()
  let waiting: Promise<unknown> | undefined
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve) })
    const engine = new DockerodePodmanEngine(socket, 1000)
    waiting = engine.getContainer('process').wait(controller.signal)
    void waiting.catch(() => undefined)
    const response = await attached.promise
    // The HTTP idle timeout is the subject; the test lane bounds the outer wait.
    await setTimeout(1200)
    expect(response.destroyed).toBe(false)
    response.end(JSON.stringify({ StatusCode: 7, Error: null }))
    await expect(waiting).resolves.toEqual({ statusCode: 7 })
  } finally {
    controller.abort()
    server.closeAllConnections()
    await waiting?.catch(() => undefined)
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    }
    await rm(root, { recursive: true, force: true })
  }
})
