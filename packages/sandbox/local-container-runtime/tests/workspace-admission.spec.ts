import { describe, expect, it } from 'vitest'
import { WorkspaceAdmission } from '../src/workspace-admission.ts'

describe('workspace execution admission', () => {
  it('admits waiters in order only after an owner releases its slot', async () => {
    const pool = new WorkspaceAdmission(1)
    const signal = new AbortController().signal
    const release = await pool.acquire(signal)
    const admitted: number[] = []
    const second = pool.acquire(signal).then((done) => { admitted.push(2); return done })
    const third = pool.acquire(signal).then((done) => { admitted.push(3); return done })
    await Promise.resolve()
    expect(admitted).toEqual([])
    release()
    const releaseSecond = await second
    expect(admitted).toEqual([2])
    release()
    await Promise.resolve()
    expect(admitted).toEqual([2])
    releaseSecond()
    const releaseThird = await third
    expect(admitted).toEqual([2, 3])
    releaseThird()
  })

  it('withdraws a cancelled waiter without releasing another conversation', async () => {
    const pool = new WorkspaceAdmission(1)
    const running = new AbortController()
    const release = await pool.acquire(running.signal)
    const cancelled = new AbortController()
    const reason = new Error('cancel queued turn')
    const rejection = expect(pool.acquire(cancelled.signal)).rejects.toBe(reason)
    let admitted = false
    const next = pool.acquire(new AbortController().signal).then((done) => { admitted = true; return done })
    cancelled.abort(reason)
    await rejection
    running.abort()
    await Promise.resolve()
    expect(admitted).toBe(false)
    release()
    const releaseNext = await next
    expect(admitted).toBe(true)
    releaseNext()
  })

  it('rejects already cancelled work without consuming available capacity', async () => {
    const pool = new WorkspaceAdmission(2)
    const cancelled = new AbortController()
    cancelled.abort(new Error('cancelled'))
    expect(() => pool.acquire(cancelled.signal)).toThrow('cancelled')
    const releases = await Promise.all([
      pool.acquire(new AbortController().signal), pool.acquire(new AbortController().signal),
    ])
    for (const release of releases) release()
  })
})
