import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { PendingInteractions } from '@deepseek-ai/dsh-client-ui-session/client/portable'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertClientEventListener } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingApproval, registerApprovalRequests } from '../src/client/portable.ts'

type Listener = TypertClientEventListener<'approval/request'>
const roots: Context[] = []
const SESSION_ID = 'portable-session' as SessionId
const REQUEST = { toolName: 'bash' }
const ANSWER = 'allowed-once' as const
const FALLBACK = 'unavailable' as const

async function bench() {
  const ctx = new Context()
  roots.push(ctx)
  const pending = new PendingInteractions()
  let listener: Listener | undefined
  const remote: Pick<ClientRemote, '$on'> = {
    $on(event, callback) {
      expect(event).toBe('approval/request')
      const remove = ctx.effect(() => {
        // This harness captures only the named event asserted above.
        listener = callback as unknown as Listener
        return () => { listener = undefined }
      })
      return () => { void remove() }
    },
  }
  registerApprovalRequests(remote, { scopeOf }, precedence => pending.register(ctx, precedence))
  const scope = createScope(ctx, SESSION_ID)
  await scope.fiber.await()
  const retained = listener
  if (retained === undefined) throw new Error('request listener was not registered')
  return {
    ctx, owner: scope.ctx, pending, retained,
    subscribed: () => listener !== undefined,
    invoke(request: Omit<Parameters<Listener>[0], 'agent'>, next: Parameters<Listener>[1] = async () => FALLBACK) {
      return retained.call(scope.ctx, { ...request, agent: scope.ctx }, next)
    },
    current() {
      const value = pending.source.getSnapshot().get(SESSION_ID)
      if (!(value instanceof PendingApproval)) throw new Error('pending request was not published')
      return value
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

describe('portable approval requests', () => {
  it('returns the answer and removes the exact published request', async () => {
    const b = await bench()
    const next = vi.fn(async () => FALLBACK)
    const result = b.invoke(REQUEST, next)
    const pending = b.current()
    expect(pending.sessionId).toBe('portable-session')
    await pending.answer(ANSWER)
    await expect(result).resolves.toEqual(ANSWER)
    expect(next).not.toHaveBeenCalled()
    expect(b.pending.source.getSnapshot().size).toBe(0)
    await expect(pending.answer(ANSWER)).rejects.toThrow('already settled')
  })

  it('delegates requests without a Session scope without publishing', async () => {
    const b = await bench()
    const next = vi.fn(async () => FALLBACK)
    await expect(b.retained.call(b.ctx, { ...REQUEST, agent: b.ctx }, next)).resolves.toEqual(FALLBACK)
    expect(next).toHaveBeenCalledOnce()
    expect(b.pending.source.getSnapshot().size).toBe(0)
  })

  it.each([false, true])('cleans up delivery cancellation, already aborted: %s', async (alreadyAborted) => {
    const b = await bench()
    const controller = new AbortController()
    const reason = new Error('Host ended request')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    if (alreadyAborted) controller.abort(reason)
    const result = b.invoke({ ...REQUEST, signal: controller.signal })
    const rejected = expect(result).rejects.toBe(reason)
    if (!alreadyAborted) controller.abort(reason)
    await rejected
    expect(remove).toHaveBeenCalledOnce()
    expect(b.pending.source.getSnapshot().size).toBe(0)
  })

  it('withdraws before delegation and waits for the next listener to finish', async () => {
    const b = await bench()
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    const result = b.invoke(REQUEST, async () => {
      expect(b.pending.source.getSnapshot().size).toBe(0)
      entered.resolve(undefined)
      await finish.promise
      return FALLBACK
    })
    let done = false
    const disposal = b.ctx.fiber.dispose().then(() => { done = true })
    try {
      await entered.promise
      expect(done).toBe(false)
    } finally {
      finish.resolve(undefined)
      await disposal
    }
    await expect(result).resolves.toEqual(FALLBACK)
    expect(b.subscribed()).toBe(false)
    expect(done).toBe(true)
  })

  it.each([false, true])('settles a late carrier after domain disposal, already aborted: %s', async (alreadyAborted) => {
    const b = await bench()
    await b.ctx.fiber.dispose()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    if (alreadyAborted) controller.abort()
    await expect(b.invoke({ ...REQUEST, signal: controller.signal })).rejects.toThrow('domain is disposed')
    expect(remove).toHaveBeenCalledOnce()
    expect(b.pending.source.getSnapshot().size).toBe(0)
  })
})
