/** Paired Host admission, generation loss and observer cleanup. */
import { describe, expect, it, vi } from 'vitest'
import { connectionIdentitySchema, type ConnectionGeneration, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { RemoteStream } from '../src/client/remote-stream.ts'
import { RemoteStreamCarrierError } from '../src/client/stream-client.ts'
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

  it('keeps a different admitted Host terminal while absence is recoverable', () => {
    const absent = source()
    expect(() => bindPinnedGeneration(absent.connection, identity.hostId, new AbortController().signal, () => new AbortController()))
      .toThrow(RemoteStreamCarrierError)
    const wrong = source({ ...ready, host: { home: '/other', identity: { ...identity, hostId: connectionIdentitySchema.parse({ ...identity, hostId: '00000000-0000-4000-8000-000000000011' }).hostId } } })
    const bindWrong = (): void => {
      bindPinnedGeneration(wrong.connection, identity.hostId, new AbortController().signal, () => new AbortController())
    }
    expect(bindWrong).toThrow('no ready connection generation')
    expect(bindWrong).not.toThrow(RemoteStreamCarrierError)
  })

  it('waits for first admission and reopens supervised reads after generation loss', async () => {
    const state = source()
    const firstFailure = Promise.withResolvers<undefined>()
    const lostGeneration = Promise.withResolvers<undefined>()
    let failures = 0
    const stream = new RemoteStream(state.connection, {
      name: 'cold native read',
      async *open(signal) {
        const binding = bindPinnedGeneration(state.connection, identity.hostId, signal, () => new AbortController())!
        try {
          yield binding.identity.activationId
          await new Promise<void>((_resolve, reject) => {
            const aborted = (): void => {
              const reason: unknown = binding.signal.reason
              reject(reason instanceof Error ? reason : new Error('fixture cancellation is not an Error', { cause: reason }))
            }
            if (binding.signal.aborted) { aborted(); return }
            binding.signal.addEventListener('abort', aborted, { once: true })
          })
        } finally { binding.dispose() }
      },
      ended: () => new Error('fixture read unexpectedly ended'),
      carrierFailed: () => { (failures++ === 0 ? firstFailure : lostGeneration).resolve(undefined) },
    })
    try {
      const iterator = stream[Symbol.asyncIterator]()
      const first = iterator.next()
      await firstFailure.promise
      state.publish(ready)
      const opening = await first
      expect(opening.done).toBe(false)
      if (opening.done) throw new Error('opening missing')
      expect(opening.value.value).toBe(identity.activationId)
      opening.value.accept()
      const second = iterator.next()
      state.publish(undefined)
      await lostGeneration.promise
      const nextIdentity = connectionIdentitySchema.parse({ ...identity, activationId: '00293014-2e9f-47ef-bc87-98fe20ebceae' })
      state.publish({ id: 2, host: { home: '/paired', identity: nextIdentity } })
      const replacement = await second
      expect(replacement.done).toBe(false)
      if (replacement.done) throw new Error('replacement missing')
      expect(replacement.value.value).toBe(nextIdentity.activationId)
      expect(replacement.value.generation).toBeGreaterThan(opening.value.generation)
    } finally { await stream.dispose() }
    expect(failures).toBe(2)
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
    expect(binding.signal.reason).toBeInstanceOf(RemoteStreamCarrierError)
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
