/** Paired Host admission, generation loss and observer cleanup. */
import { describe, expect, it, vi } from 'vitest'
import { connectionIdentitySchema, type ConnectionGeneration, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { bindPinnedGeneration } from '../src/client/pinned-generation.ts'

const identity = connectionIdentitySchema.parse({ version: 1, hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02' })
function source(initial?: ConnectionGeneration) {
  let snapshot = initial
  const observers = new Set<() => void>()
  const connection = { generation: {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { observers.add(listener); return () => { observers.delete(listener) } },
  } } as ConnectionHandle
  return { connection, observers, publish(value: ConnectionGeneration | undefined) {
    snapshot = value
    for (const observer of observers) observer()
  } }
}
const ready: ConnectionGeneration = { id: 1, host: { home: '/paired', identity } }

describe('pinned generation operation lifetime', () => {
  it('leaves an origin-authenticated composition without a pin unchanged', () => {
    const state = source()
    const create = vi.fn(() => new AbortController())
    expect(bindPinnedGeneration(state.connection, undefined, new AbortController().signal, create)).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
    expect(state.observers.size).toBe(0)
  })

  it.each([undefined, { id: 1, host: { home: '/synthetic' } },
    { id: 1, host: { home: '/other', identity: connectionIdentitySchema.parse({ ...identity, hostId: '00000000-0000-4000-8000-000000000011' }) } },
  ])('refuses an absent or different paired Host %#', (generation) => {
    const state = source(generation)
    expect(() => bindPinnedGeneration(state.connection, identity.hostId, new AbortController().signal, () => new AbortController())).toThrow('no ready connection generation')
    expect(state.observers.size).toBe(0)
  })

  it('cancels only when the accepted generation ends and releases observers', () => {
    const state = source(ready)
    const caller = new AbortController()
    const binding = bindPinnedGeneration(state.connection, identity.hostId, caller.signal, () => new AbortController())!
    binding.assertCurrent()
    state.publish(ready)
    expect(binding.signal.aborted).toBe(false)
    expect(state.observers.size).toBe(1)
    state.publish(undefined)
    expect(binding.signal.aborted).toBe(true)
    expect(() => { binding.assertCurrent() }).toThrow('operation outcome may be uncertain')
    binding.dispose()
    expect(state.observers.size).toBe(0)
  })

  it('preserves caller cancellation and detaches listeners after success', () => {
    const state = source(ready)
    const caller = new AbortController()
    const add = vi.spyOn(caller.signal, 'addEventListener')
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    const binding = bindPinnedGeneration(state.connection, identity.hostId, caller.signal, () => new AbortController())!
    const reason = new Error('cancelled by caller')
    caller.abort(reason)
    expect(binding.signal.reason).toBe(reason)
    binding.dispose()
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length)
    expect(state.observers.size).toBe(0)
    const settled = bindPinnedGeneration(state.connection, identity.hostId, new AbortController().signal, () => new AbortController())!
    settled.dispose()
    state.publish(undefined)
    expect(settled.signal.aborted).toBe(false)
  })
})
