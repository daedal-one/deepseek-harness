import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSaveAttempt, joinWorkspaceOperation, workspaceSaveDiagnostic } from '../src/workspace-save.ts'

afterEach(() => { vi.useRealTimers() })

describe('workspace save lifetime', () => {
  it('rejects illegal transitions and permits terminal persistence failure', () => {
    const attempt = new WorkspaceSaveAttempt(1000)
    try {
      expect(() => { attempt.transition('returned') }).toThrow('Invalid workspace save transition')
      attempt.transition('saving')
      attempt.transition('returned')
      expect(() => { attempt.transition('cancelled') }).toThrow('Invalid workspace save transition')
      attempt.transition('failed')
      expect(() => { attempt.transition('saving') }).toThrow('Invalid workspace save transition')
    } finally { attempt.dispose() }
  })
  it('fences entry and continuation after cancellation', async () => {
    const attempt = new WorkspaceSaveAttempt(10_000)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    try {
      const running = attempt.run('return', async () => { entered.resolve(undefined); await release.promise; return 1 })
      const rejected = expect(running).rejects.toThrow('Workspace save cancelled')
      await entered.promise
      attempt.cancel()
      const effect = vi.fn(async () => 2)
      await expect(attempt.run('commit', effect)).rejects.toThrow('Workspace save cancelled')
      expect(effect).not.toHaveBeenCalled()
      release.resolve(undefined)
      await rejected
    } finally { release.resolve(undefined); attempt.dispose() }
  })

  it('expires the entire attempt and does not confuse a join timeout with quiescence', async () => {
    vi.useFakeTimers()
    const attempt = new WorkspaceSaveAttempt(100)
    const operation = Promise.withResolvers<undefined>()
    try {
      const joined = joinWorkspaceOperation(operation.promise, 50)
      await vi.advanceTimersByTimeAsync(50)
      expect(await joined).toBe(false)
      expect(attempt.signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(50)
      expect(attempt.signal.reason).toEqual(new Error('Workspace save deadline exceeded'))
      operation.reject(new Error('late failure'))
      expect(await joinWorkspaceOperation(operation.promise, 50)).toBe(true)
      expect(await joinWorkspaceOperation(Promise.resolve(), 50)).toBe(true)
    } finally { attempt.dispose() }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds nested causes and excludes arbitrary subprocess secrets', () => {
    const secret = new Error('https://user:secret@example.test token=never-persist-me ' + 'x'.repeat(20_000))
    const loop = new Error('outer', { cause: secret })
    secret.cause = loop
    const result = workspaceSaveDiagnostic(new AggregateError([loop, ...Array.from({ length: 20 }, () => secret),
      new Error('workspace byte limit exceeded')], 'provider failed'), 'return', false, '/workspace/repos/abcd')
    expect(result.stage).toBe('return')
    expect(result.quiescent).toBe(false)
    expect(result.causes.length).toBeLessThanOrEqual(8)
    expect(JSON.stringify(result)).not.toMatch(/secret|never-persist|user:/u)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096)
    expect(workspaceSaveDiagnostic(new Error('workspace byte limit exceeded'), 'capture', true).causes[0]?.code).toBe('quota')
    expect(workspaceSaveDiagnostic(undefined, 'cleanup', false).causes[0]?.fingerprint).toHaveLength(64)
  })
})
