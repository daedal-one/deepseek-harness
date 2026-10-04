import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { SessionTerminalId, SessionTerminalSize } from '../src/types.ts'
import { SessionTerminals } from '../src/terminal.ts'

const resources: SessionTerminals[] = []
afterEach(async () => { await Promise.all(resources.splice(0).map(owner => owner.dispose())) })

function fixture() {
  const output = new PassThrough()
  const outcome = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  const handle = {
    pid: 1, output, done: outcome.promise,
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}),
    inspectForeground: async () => undefined, signalForeground: async () => 1,
    terminate: vi.fn(async () => { output.destroy(); outcome.resolve({ exitCode: null, signal: 'SIGTERM' }) }),
  } satisfies SubprocessTerminalHandle
  const subprocess = {
    resolveWorkingDirectory: vi.fn(() => '/workspace/project'),
    resolveExecutable: vi.fn(async () => '/bin/bash'),
    spawnTerminal: vi.fn(async (): Promise<SubprocessTerminalHandle> => handle),
  }
  let attributed = false
  const agent = { session: { header: { cwd: '/host/project' } }, ctx: {
    get: (name: string) => name === 'subprocess' ? subprocess : undefined,
    agents: { withInitiator: async (_agent: unknown, run: () => Promise<unknown>) => {
      attributed = true
      return run()
    } },
  } } as unknown as Agent
  const owner = new SessionTerminals({ argv: ['bash', '-i'], graceMs: 1000, maxInputBytes: 8, maxTerminals: 1 })
  resources.push(owner)
  const request: SessionTerminalSize = { sessionId: 'one' as SessionId, terminalId: 'pty-one' as SessionTerminalId, rows: 24, cols: 80 }
  const abort = new AbortController()
  const stream = owner.open(agent, request, abort.signal)
  return { owner, agent, handle, subprocess, request, abort, stream, output, outcome, attributed: () => attributed }
}

describe('Session user terminal', () => {
  it('allocates with initiating Agent ownership and execution-world cwd, routes input/resize, and drains exit output', async () => {
    const f = fixture()
    expect(await f.stream.next()).toEqual({ done: false, value: { kind: 'ready', cwd: '/workspace/project', maxInputBytes: 8 } })
    expect(f.attributed()).toBe(true)
    expect(f.subprocess.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({ argv: ['/bin/bash', '-i'], cwd: '/workspace/project', rows: 24, cols: 80 }))
    await f.owner.input({ ...f.request, data: 'pwd\r' })
    expect(f.handle.write).toHaveBeenCalledWith('pwd\r')
    await f.owner.resize({ ...f.request, rows: 40, cols: 120 })
    expect(f.handle.resize).toHaveBeenCalledWith(40, 120)
    f.output.end('hello\r\n')
    f.outcome.resolve({ exitCode: 0, signal: null })
    expect((await f.stream.next()).value).toEqual({ kind: 'output', data: 'hello\r\n' })
    expect((await f.stream.next()).value).toEqual({ kind: 'exit', exitCode: 0, signal: null })
    expect((await f.stream.next()).done).toBe(true)
    expect(f.handle.terminate).toHaveBeenCalledOnce()
  })

  it('rejects cross-session access, oversized UTF-8 input, invalid dimensions and concurrent capacity', async () => {
    const f = fixture()
    await f.stream.next()
    await expect(f.owner.input({ ...f.request, sessionId: 'two' as SessionId, data: 'x' })).rejects.toThrow('not open for this session')
    await expect(f.owner.input({ ...f.request, data: '😀😀x' })).rejects.toThrow('configured limit')
    await expect(f.owner.resize({ ...f.request, rows: 0 })).rejects.toThrow('dimensions')
    await expect(f.owner.open(f.agent, { ...f.request, terminalId: 'pty-two' as SessionTerminalId }, f.abort.signal).next()).rejects.toThrow('capacity')
    await expect(f.owner.open(f.agent, f.request, f.abort.signal).next()).rejects.toThrow('already open')
    await f.stream.return(undefined)
    expect(f.handle.write).not.toHaveBeenCalled()
  })

  it('cancels a waiting output read and awaits process cleanup on disposal', async () => {
    const f = fixture()
    await f.stream.next()
    const read = f.stream.next()
    const rejected = expect(read).rejects.toThrow()
    await f.owner.dispose()
    await rejected
    expect(f.handle.terminate).toHaveBeenCalled()
    await expect(f.owner.input({ ...f.request, data: 'x' })).rejects.toThrow('not open')
  })

  it('refuses a Session without a subprocess provider instead of allocating on the Host', async () => {
    const f = fixture()
    const agent = { ...f.agent, ctx: { get: () => undefined } } as unknown as Agent
    await expect(f.owner.open(agent, f.request, f.abort.signal).next()).rejects.toThrow('no terminal subprocess')
    expect(f.subprocess.spawnTerminal).not.toHaveBeenCalled()
  })

  it('does not publish a terminal cancelled during allocation and terminates the returned handle', async () => {
    const f = fixture()
    const allocation = Promise.withResolvers<SubprocessTerminalHandle>()
    const entered = Promise.withResolvers<undefined>()
    f.subprocess.spawnTerminal.mockImplementation(async () => { entered.resolve(undefined); return allocation.promise })
    const read = f.stream.next()
    const rejected = expect(read).rejects.toThrow()
    await entered.promise
    f.abort.abort()
    allocation.resolve(f.handle)
    await rejected
    expect(f.handle.terminate).toHaveBeenCalledOnce()
  })
  it('refuses missing cwd, invalid viewports, pre-aborted streams and admission after disposal', async () => {
    const f = fixture()
    for (const size of [{ rows: 1.5 }, { cols: 1.5 }, { cols: 1 }, { rows: 1001 }, { cols: 1001 }]) {
      await expect(f.owner.open(f.agent, { ...f.request, ...size }, f.abort.signal).next()).rejects.toThrow('dimensions')
    }
    const agent = { ...f.agent, session: { header: {} } } as unknown as Agent
    await expect(f.owner.open(agent, f.request, f.abort.signal).next()).rejects.toThrow('working directory')
    f.abort.abort()
    await expect(f.stream.next()).rejects.toThrow()
    await f.owner.dispose()
    await expect(f.owner.open(f.agent, f.request, new AbortController().signal).next()).rejects.toThrow('disposing')
  })

  it('splits large output at Unicode boundaries and reports provider failure after draining', async () => {
    const f = fixture()
    await f.stream.next()
    f.output.end('1234567😀abcdefgh')
    f.outcome.reject(new Error('provider transport lost'))
    const data: string[] = []
    await expect((async () => {
      for await (const frame of f.stream) if (frame.kind === 'output') data.push(frame.data)
    })()).rejects.toThrow('transport lost')
    expect(data.join('')).toBe('1234567😀abcdefgh')
    expect(data.every(chunk => !/[\uD800-\uDBFF]$/u.test(chunk))).toBe(true)
    expect(f.handle.terminate).toHaveBeenCalledOnce()
  })

  it('terminates a published process on disposal even while the consumer is paused after ready', async () => {
    const f = fixture()
    await f.stream.next()
    await f.owner.dispose()
    expect(f.handle.terminate).toHaveBeenCalledOnce()
    await expect(f.stream.next()).rejects.toThrow()
  })

  it('waits for cleanup admitted during allocation before disposal completes', async () => {
    const f = fixture()
    const allocated = Promise.withResolvers<SubprocessTerminalHandle>()
    const entered = Promise.withResolvers<undefined>()
    const cleaned = Promise.withResolvers<undefined>()
    f.subprocess.spawnTerminal.mockImplementation(async () => { entered.resolve(undefined); return allocated.promise })
    f.handle.terminate.mockImplementation(async () => { await cleaned.promise })
    const read = f.stream.next()
    const cancelled = expect(read).rejects.toThrow()
    await entered.promise
    let disposed = false
    const disposal = f.owner.dispose().then(() => { disposed = true })
    allocated.resolve(f.handle)
    await vi.waitFor(() => { expect(f.handle.terminate).toHaveBeenCalled() })
    expect(disposed).toBe(false)
    cleaned.resolve(undefined)
    await disposal
    await cancelled
  })

  it('reports failed process cleanup after joining every owned cleanup', async () => {
    const f = fixture()
    await f.stream.next()
    f.handle.terminate.mockRejectedValue(new Error('cleanup transport failed'))
    await expect(f.owner.dispose()).rejects.toThrow('process cleanup failed')
    await expect(f.stream.next()).rejects.toThrow('cleanup transport failed')
  })

})
