import { afterEach, describe, expect, it, vi } from 'vitest'
import { TtlCache } from '../src/cache.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('TtlCache', () => {
  it('serves a hit inside the TTL without reloading', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const load = vi.fn(async () => 'first')
    const cache = new TtlCache<string>(10_000)

    expect(await cache.read(load)).toBe('first')
    vi.advanceTimersByTime(9_999)
    expect(await cache.read(load)).toBe('first')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('misses after the TTL and reloads', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    let calls = 0
    const load = vi.fn(async () => `v${++calls}`)
    const cache = new TtlCache<string>(10_000)

    expect(await cache.read(load)).toBe('v1')
    vi.advanceTimersByTime(10_000)
    expect(await cache.read(load)).toBe('v2')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('de-duplicates concurrent reads into one in-flight load', async () => {
    vi.useFakeTimers()
    const release = Promise.withResolvers<string>()
    const load = vi.fn(() => release.promise)
    const cache = new TtlCache<string>(10_000)

    const first = cache.read(load)
    const second = cache.read(load)
    release.resolve('shared')
    await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache a rejected load and retries on the next read', async () => {
    vi.useFakeTimers()
    const failure = new Error('boom')
    let calls = 0
    const load = vi.fn(() => {
      calls += 1
      return calls === 1 ? Promise.reject(failure) : Promise.resolve('recovered')
    })
    const cache = new TtlCache<string>(10_000)

    await expect(cache.read(load)).rejects.toBe(failure)
    expect(load).toHaveBeenCalledTimes(1)
    expect(await cache.read(load)).toBe('recovered')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one rejection across concurrent waiters and retries afterwards', async () => {
    vi.useFakeTimers()
    let rejectLoad: (reason: unknown) => void = () => {}
    const pending = new Promise<string>((_resolve, reject) => {
      rejectLoad = reject
    })
    let calls = 0
    const load = vi.fn(() => {
      calls += 1
      return calls === 1 ? pending : Promise.resolve('recovered')
    })
    const cache = new TtlCache<string>(10_000)

    const first = cache.read(load)
    const second = cache.read(load)
    rejectLoad(new Error('down'))
    await expect(first).rejects.toThrow('down')
    await expect(second).rejects.toThrow('down')
    expect(load).toHaveBeenCalledTimes(1)
    expect(await cache.read(load)).toBe('recovered')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('throws a RangeError for a non-negative-finite TTL violation', () => {
    expect(() => new TtlCache(-1)).toThrow(RangeError)
    expect(() => new TtlCache(NaN)).toThrow(RangeError)
    expect(() => new TtlCache(Infinity)).toThrow(RangeError)
    expect(() => new TtlCache(0)).not.toThrow()
  })
})
