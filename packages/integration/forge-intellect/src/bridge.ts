/** A per-run private transport into the running Harness's isolated reviewers. */
import { createServer, type Socket } from 'node:net'
import { mkdtemp, chmod, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Packet } from './contract.ts'
import { packetSchema } from './contract.ts'

/** Compare JSON independent of key order; preserves array order and primitive values.
 * @param value - JSON-compatible input.
 * @returns Stable JSON representation.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value)
}

/** Open a local-only broker and return an awaited teardown that cancels every child.
 * @param run - native run directory that owns retained requests.
 * @param signal - cancellation shared by the complete run.
 * @param review - isolated reviewer called once per role and stage.
 * @returns Private socket path and awaited resource teardown.
 */
export async function openBridge(
  run: string, signal: AbortSignal, review: (packet: Packet, directory: string, signal: AbortSignal) => Promise<unknown>,
): Promise<{ path: string; close(): Promise<void> }> {
  const temp = await mkdtemp('/tmp/dsh-intellect-')
  await chmod(temp, 0o700)
  const path = join(temp, 'review.sock')
  const sockets = new Set<Socket>()
  const pending = new Set<Promise<void>>()
  const calls = new Set<string>()
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    const controller = new AbortController()
    const cancelled = AbortSignal.any([signal, controller.signal])
    socket.on('error', () =>{  controller.abort() })
    socket.on('close', () => { sockets.delete(socket); controller.abort() })
    const handle = async () => {
      try {
        let input = ''
        for await (const chunk of socket) {
          input += z.string().parse(chunk)
          if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error('Verification packet exceeds budget')
        }
        const request = z.object({ directory: z.string(), packet: packetSchema }).strict().parse(JSON.parse(input))
        const expected = join(run, 'agents', request.packet.role, request.packet.stage)
        if (await realpath(request.directory) !== await realpath(expected)) throw new Error('Reviewer requested a foreign evidence directory')
        const retained = packetSchema.parse(JSON.parse(await readFile(join(expected, 'request.json'), 'utf8')))
        if (canonical(retained) !== canonical(request.packet)) throw new Error('Reviewer packet differs from retained native input')
        const key = `${retained.role}/${retained.stage}`
        if (calls.has(key)) throw new Error('Reviewer stage already consumed')
        calls.add(key)
        const result = await review(retained, expected, cancelled)
        const text = JSON.stringify(result, (_key, value: unknown) => typeof value === 'number' && !Number.isInteger(value) ? String(value) : value)
        if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Verification response exceeds budget')
        socket.end(text)
      } catch (error) {
        socket.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Reviewer failed' }))
      }
    }
    const done = handle().finally(() => pending.delete(done))
    pending.add(done)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => { server.removeListener('error', reject); resolve() })
    })
    return {
      path,
      async close() {
        const closed = new Promise<void>((resolve, reject) => server.close((error) => {
          if (error) reject(error)
          else resolve()
        }))
        for (const socket of sockets) socket.destroy()
        await Promise.allSettled([...pending])
        await closed
        await rm(temp, { recursive: true, force: true })
      },
    }
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    server.close()
    await rm(temp, { recursive: true, force: true })
    throw error
  }
}
