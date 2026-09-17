import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingInteractions, type SessionPendingInteractionBase } from '../src/client/portable.ts'

const roots: Context[] = []
function owner(): Context {
  const ctx = new Context()
  roots.push(ctx)
  return ctx
}
function request(key: string, session = 's1'): SessionPendingInteractionBase {
  return { key, kind: 'approval', sessionId: session as SessionId }
}
const delegate = () => Promise.resolve()

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

describe('portable pending interactions', () => {
  it('keeps cached snapshots and exact requests across hidden changes and independent Hosts', async () => {
    const registry = new PendingInteractions()
    const other = new PendingInteractions()
    const ctx = owner()
    const otherRequest = request('other')
    other.register<SessionPendingInteractionBase>(owner(), () => 1)(otherRequest, delegate)
    // oxlint-disable-next-line typescript/unbound-method -- Verify these arrow-backed observables without a receiver.
    const { getSnapshot, subscribe } = registry.source
    const initial = getSnapshot()
    const lower = registry.register<SessionPendingInteractionBase>(ctx, () => 0)
    const higher = registry.register<SessionPendingInteractionBase>(ctx, () => 1)
    expect(getSnapshot()).toBe(initial)
    const listener = vi.fn()
    const off = subscribe(listener)
    const low = request('low')
    const high = request('high')
    const removeLow = lower(low, delegate)
    const removeHigh = higher(high, delegate)
    const visible = getSnapshot()
    expect(visible.get(high.sessionId)).toBe(high)
    expect(other.source.getSnapshot().get(otherRequest.sessionId)).toBe(otherRequest)
    removeLow()
    expect(getSnapshot()).toBe(visible)
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    removeHigh()
    expect(getSnapshot().size).toBe(0)
    expect(listener).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
    expect(other.source.getSnapshot().get(otherRequest.sessionId)).toBe(otherRequest)
  })

  it('keeps same keys independent across domains and breaks precedence ties in traversal order', async () => {
    const registry = new PendingInteractions()
    const a = owner()
    const b = owner()
    const first = registry.register<SessionPendingInteractionBase>(a, () => 1)
    const second = registry.register<SessionPendingInteractionBase>(b, () => 1)
    const one = request('same')
    const two = request('same')
    const third = request('third', 's2')
    first(one, delegate)
    second(two, delegate)
    first(third, delegate)
    expect([...registry.source.getSnapshot().values()]).toEqual([two, third])
    expect(() => first(one, delegate)).toThrow("duplicate pending interaction key 'same'")
    await b.fiber.dispose()
    expect(registry.source.getSnapshot().get(one.sessionId)).toBe(one)
    expect(registry.source.getSnapshot().get(third.sessionId)).toBe(third)
  })

  it('withdraws every request before delegation and waits for all owners despite a rejected delegate', async () => {
    const registry = new PendingInteractions()
    const ctx = owner()
    const publish = registry.register<SessionPendingInteractionBase>(ctx, () => 1)
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    const first = request('first')
    const second = request('second')
    const remove = publish(first, () => {
      expect(registry.source.getSnapshot().size).toBe(0)
      throw new Error('delegate failed')
    })
    publish(second, async () => {
      expect(registry.source.getSnapshot().size).toBe(0)
      started.resolve(undefined)
      await finish.promise
    })
    let done = false
    const disposal = ctx.fiber.dispose().then(() => { done = true })
    try {
      await started.promise
      expect(done).toBe(false)
      expect(() => publish(request('late'), delegate)).toThrow('domain is disposed')
      remove()
      remove()
      expect(registry.source.getSnapshot().size).toBe(0)
    } finally {
      finish.resolve(undefined)
      await disposal
    }
    expect(done).toBe(true)
  })

  it('does not delegate a settled request and lets its identity be reused', async () => {
    const registry = new PendingInteractions()
    const ctx = owner()
    const publish = registry.register<SessionPendingInteractionBase>(ctx, () => 0)
    const settled = vi.fn(delegate)
    const active = vi.fn(delegate)
    const one = request('one')
    const remove = publish(one, settled)
    remove()
    publish(one, active)
    remove()
    expect(registry.source.getSnapshot().get(one.sessionId)).toBe(one)
    await ctx.fiber.dispose()
    expect(settled).not.toHaveBeenCalled()
    expect(active).toHaveBeenCalledOnce()
  })

  it('continues notifying after a subscriber throws', () => {
    const registry = new PendingInteractions()
    const publish = registry.register<SessionPendingInteractionBase>(owner(), () => 0)
    const failure = new Error('subscriber failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const offFailure = registry.source.subscribe(() => { throw failure })
    const listener = vi.fn()
    const offListener = registry.source.subscribe(listener)
    try {
      publish(request('one'), delegate)
      expect(listener).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledWith('[ui-session] pending interactions subscriber failed:', failure)
    } finally {
      offFailure()
      offListener()
    }
  })
})
