import Dockerode from 'dockerode'
import { Duplex } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { DockerodePodmanEngine } from '../src/engine.ts'

function frame(text: string): Buffer {
  const payload = Buffer.from(text)
  const header = Buffer.alloc(8)
  header[0] = 1
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

describe('controller input delivery', () => {
  it.each([false, true])('retains output when a short-lived command closes its input, signal=%s', async (signal) => {
    const endInput = vi.fn((callback: (error?: Error) => void) => {
      callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    })
    const stream = new Duplex({
      read() { this.push(frame('not installed')); this.push(null) },
      write(_chunk, _encoding, callback) { callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })) },
      final: endInput,
    })
    const start = vi.fn((_options: unknown, callback: (error: Error | null, stream: Duplex) => void) => { callback(null, stream) })
    const inspect = vi.fn(async () => ({ ExitCode: 1 }))
    const exec = vi.fn(async () => ({ start, inspect }))
    // The test supplies only Dockerode methods reached by the Engine adapter.
    const container = { exec } as unknown as Dockerode.Container
    const getContainer = vi.spyOn(Dockerode.prototype, 'getContainer').mockReturnValue(container)
    try {
      const engine = new DockerodePodmanEngine('/unused-engine.sock', 1000)
      const result = await engine.getContainer('probe').runController({
        argv: ['/bin/sh', '-c', 'command -v missing-editor'], stdin: new Uint8Array(), maxOutputBytes: 128,
        ...(signal ? { signal: new AbortController().signal } : {}),
      })
      expect(result).toEqual({ exitCode: 1, stdout: Buffer.from('not installed'), stderr: Buffer.alloc(0) })
      expect(endInput).not.toHaveBeenCalled()
      expect(exec).toHaveBeenCalledWith(expect.objectContaining({ AttachStdin: false }))
    } finally { getContainer.mockRestore(); stream.destroy() }
  })

  it('delivers nonempty input and closes it before reading the response', async () => {
    const received: Buffer[] = []
    const stream = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, callback) { received.push(chunk); callback() },
      final(callback) { this.push(frame(Buffer.concat(received).toString())); this.push(null); callback() },
    })
    const start = vi.fn((_options: unknown, callback: (error: Error | null, stream: Duplex) => void) => { callback(null, stream) })
    const exec = vi.fn(async () => ({ start, inspect: async () => ({ ExitCode: 0 }) }))
    // The test supplies only Dockerode methods reached by the Engine adapter.
    const container = { exec } as unknown as Dockerode.Container
    const getContainer = vi.spyOn(Dockerode.prototype, 'getContainer').mockReturnValue(container)
    try {
      const engine = new DockerodePodmanEngine('/unused-engine.sock', 1000)
      const result = await engine.getContainer('controller').runController({
        argv: ['/bin/cat'], stdin: Buffer.from('request body'), maxOutputBytes: 128,
      })
      expect(result).toEqual({ exitCode: 0, stdout: Buffer.from('request body'), stderr: Buffer.alloc(0) })
      expect(exec).toHaveBeenCalledWith(expect.objectContaining({ AttachStdin: true }))
    } finally { getContainer.mockRestore(); stream.destroy() }
  })
})
