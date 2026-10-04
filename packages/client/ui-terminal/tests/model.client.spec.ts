import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TerminalModel } from '../src/client/model.ts'

function setup(outputChars = 32, limit = 4) {
  const started = Promise.withResolvers<undefined>()
  const ended = Promise.withResolvers<undefined>()
  const terminalInput = vi.fn(async () => ({ ok: true }))
  const terminalResize = vi.fn(async () => ({ ok: true }))
  const terminal = vi.fn(async function* (_request: unknown, signal: AbortSignal) {
    signal.addEventListener('abort', () => { ended.resolve(undefined) }, { once: true })
    yield { kind: 'ready', cwd: '/workspace', maxInputBytes: limit }
    yield { kind: 'output', data: 'abcd😀efgh' }
    started.resolve(undefined)
    await ended.promise
  })
  const remote = { session: { terminal, terminalInput, terminalResize } } as unknown as ClientRemote
  return { model: new TerminalModel(remote, 'one' as SessionId, outputChars), started, terminal, terminalInput, terminalResize }
}

describe('browser terminal lifetime', () => {
  it('keeps one stream across view remounts, retains bounded Unicode output and awaits abort', async () => {
    const f = setup(7)
    try {
      f.model.start(24, 80)
      await f.started.promise
      f.model.start(40, 120)
      expect(f.terminal).toHaveBeenCalledOnce()
      expect(f.model.source.getSnapshot()).toMatchObject({ status: 'open', text: 'd😀efgh', offset: 3, cwd: '/workspace' })
    } finally { await f.model.dispose() }
    expect(f.model.source.getSnapshot().status).toBe('closed')
  })

  it('splits pasted Unicode at the advertised byte limit and delivers resize', async () => {
    const f = setup()
    f.model.start(24, 80)
    await f.started.promise
    f.model.input('😀AB')
    await vi.waitFor(() => { expect(f.terminalInput).toHaveBeenCalledTimes(3) })
    expect(f.terminalInput.mock.calls.map(call => (call as unknown as [{ data: string }])[0].data)).toEqual(['😀', 'A', 'B'])
    f.model.resize(40, 120)
    expect(f.terminalResize).toHaveBeenCalledWith(expect.objectContaining({ rows: 40, cols: 120 }), expect.any(AbortSignal))
    await f.model.dispose()
  })

  it('does not allocate a replacement shell until explicit restart', async () => {
    const f = setup()
    f.model.start(24, 80)
    await f.started.promise
    await f.model.dispose()
    expect(f.terminal).toHaveBeenCalledOnce()
    await f.model.restart(30, 90)
    await vi.waitFor(() => { expect(f.terminal).toHaveBeenCalledTimes(2) })
    await f.model.dispose()
  })
})

describe('terminal failure and cancellation', () => {
  it('ignores input and resizing outside an admitted shell', async () => {
    const f = setup()
    f.model.input('x'); f.model.resize(24, 80)
    await f.model.dispose()
    f.model.start(24, 80)
    f.model.input('x'); f.model.resize(24, 80)
    await f.started.promise
    await f.model.dispose()
    f.model.input('x'); f.model.resize(24, 80)
    expect(f.terminalInput).not.toHaveBeenCalled()
    expect(f.terminalResize).not.toHaveBeenCalled()
  })

  it('discards queued input after cancellation', async () => {
    const f = setup()
    f.model.start(24, 80)
    await f.started.promise
    f.model.input('AB')
    await f.model.dispose()
    expect(f.terminalInput).not.toHaveBeenCalled()
  })

  it('retains complete Unicode characters and splits a larger paste safely', async () => {
    const f = setup(5, 8)
    f.model.start(24, 80)
    await f.started.promise
    expect(f.model.source.getSnapshot().text).toBe('efgh')
    f.model.input('A😀B')
    await vi.waitFor(() => { expect(f.terminalInput).toHaveBeenCalledTimes(3) })
    expect(f.terminalInput.mock.calls.map(call => (call as unknown as [{ data: string }])[0].data)).toEqual(['A', '😀', 'B'])
    await f.model.dispose()
  })

  it.each(['input', 'resize'] as const)('surfaces an admitted %s refusal', async (operation) => {
    const f = setup()
    const method = operation === 'input' ? f.terminalInput : f.terminalResize
    method.mockResolvedValueOnce({ ok: false, error: { message: 'operation refused' } } as never)
    f.model.start(24, 80)
    await f.started.promise
    if (operation === 'input') f.model.input('x')
    else f.model.resize(24, 80)
    await vi.waitFor(() => { expect(f.model.source.getSnapshot()).toMatchObject({ status: 'error', error: 'operation refused' }) })
    await f.model.dispose()
    expect(f.model.source.getSnapshot().status).toBe('error')
  })

  it('surfaces a resize transport exception', async () => {
    const f = setup()
    f.terminalResize.mockRejectedValueOnce('resize transport failed')
    f.model.start(24, 80)
    await f.started.promise
    f.model.resize(24, 80)
    await vi.waitFor(() => { expect(f.model.source.getSnapshot()).toMatchObject({ status: 'error', error: 'resize transport failed' }) })
    await f.model.dispose()
  })

  it.each(['input', 'resize'] as const)('ignores old %s transport failures after cancellation', async (operation) => {
    const f = setup()
    const response = Promise.withResolvers<{ ok: boolean }>()
    const method = operation === 'input' ? f.terminalInput : f.terminalResize
    method.mockImplementationOnce(async () => response.promise)
    f.model.start(24, 80)
    await f.started.promise
    if (operation === 'input') f.model.input('x')
    else f.model.resize(24, 80)
    await vi.waitFor(() => { expect(method).toHaveBeenCalledOnce() })
    const disposal = f.model.dispose()
    response.reject(new Error('late failure'))
    await disposal
    expect(f.model.source.getSnapshot().status).toBe('closed')
  })

  it('ignores an old resize refusal after cancellation', async () => {
    const f = setup()
    const response = Promise.withResolvers<{ ok: boolean }>()
    f.terminalResize.mockImplementationOnce(async () => response.promise)
    f.model.start(24, 80)
    await f.started.promise
    f.model.resize(24, 80)
    const disposal = f.model.dispose()
    response.resolve({ ok: false, error: { message: 'late refusal' } } as never)
    await disposal
    expect(f.model.source.getSnapshot().status).toBe('closed')
  })

  it.each([new Error('stream failed'), 'stream failed'])('surfaces stream failures without opening another shell', async (error) => {
    const f = setup()
    f.terminal.mockImplementationOnce(async function* () {
      yield { kind: 'ready', cwd: '/workspace', maxInputBytes: 4 }
      throw error
    })
    f.model.start(24, 80)
    await vi.waitFor(() => { expect(f.model.source.getSnapshot()).toMatchObject({ status: 'error', error: 'stream failed' }) })
    f.model.start(24, 80)
    expect(f.terminal).toHaveBeenCalledOnce()
    await f.model.dispose()
  })

  it('rejects a frame arriving after cancellation', async () => {
    const f = setup()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    f.terminal.mockImplementationOnce(async function* () {
      entered.resolve(undefined)
      await release.promise
      yield { kind: 'ready', cwd: '/late-workspace', maxInputBytes: 4 }
    })
    f.model.start(24, 80)
    await entered.promise
    const disposal = f.model.dispose()
    release.resolve(undefined)
    await disposal
    expect(f.model.source.getSnapshot()).toMatchObject({ status: 'closed', cwd: '' })
  })

  it('classifies an aborted stream rejection as closed', async () => {
    const f = setup()
    const entered = Promise.withResolvers<undefined>()
    f.terminal.mockImplementationOnce(async function* (_request, signal) {
      yield { kind: 'ready', cwd: '/workspace', maxInputBytes: 4 }
      entered.resolve(undefined)
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
      })
    })
    f.model.start(24, 80)
    await entered.promise
    await f.model.dispose()
    expect(f.model.source.getSnapshot().status).toBe('closed')
  })

  it('projects an ordinary shell exit as closed', async () => {
    const f = setup()
    f.terminal.mockImplementationOnce(async function* () {
      yield { kind: 'ready', cwd: '/workspace', maxInputBytes: 4 }
      yield { kind: 'output', data: '' }
      yield { kind: 'exit', exitCode: 0, signal: null } as never
    })
    f.model.start(24, 80)
    await vi.waitFor(() => { expect(f.model.source.getSnapshot().status).toBe('closed') })
    await f.model.dispose()
  })
})
