import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { brotliDecompressSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { bridge } from '../src/http-bridge.ts'

describe('HTTP bridge abort', () => {
  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'host.pickDirectory', payload: {},
    })
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/host.pickDirectory',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(request, response, {
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })

  it('compresses complete JSON responses while leaving streaming responses untouched', async () => {
    const makeRequest = (): IncomingMessage => {
      const request = Readable.from([]) as unknown as IncomingMessage
      Object.assign(request, {
        url: '/api/probe', method: 'GET', headers: { 'accept-encoding': 'br' },
      })
      return request
    }
    const record = (): {
      response: ServerResponse
      status: () => number
      headers: () => Record<string, string | number>
      body: () => Buffer
    } => {
      let status = 0
      let headers: Record<string, string | number> = {}
      const chunks: Buffer[] = []
      const response = Object.assign(new EventEmitter(), {
        writableEnded: false,
        writeHead(nextStatus: number, nextHeaders?: Record<string, string | number>) {
          status = nextStatus
          headers = nextHeaders ?? {}
          return this
        },
        write(chunk: Uint8Array) { chunks.push(Buffer.from(chunk)); return true },
        end(this: { writableEnded: boolean }, chunk?: Uint8Array) {
          if (chunk !== undefined) chunks.push(Buffer.from(chunk))
          this.writableEnded = true
          return this
        },
      }) as unknown as ServerResponse
      return { response, status: () => status, headers: () => headers, body: () => Buffer.concat(chunks) }
    }

    const unary = record()
    const source = JSON.stringify({ payload: 'x'.repeat(4_096) })
    await bridge(makeRequest(), unary.response, {
      fetch: () => Promise.resolve(new Response(source, { headers: { 'content-type': 'application/json' } })),
    })
    expect(unary.status()).toBe(200)
    expect(unary.headers()).toMatchObject({ 'content-encoding': 'br', vary: 'Accept-Encoding' })
    expect(brotliDecompressSync(unary.body()).toString()).toBe(source)

    const stream = record()
    await bridge(makeRequest(), stream.response, {
      fetch: () => Promise.resolve(new Response('data: one\n\n', { headers: { 'content-type': 'text/event-stream' } })),
    })
    expect(stream.headers()).not.toHaveProperty('content-encoding')
    expect(stream.body().toString()).toBe('data: one\n\n')
  })
})
