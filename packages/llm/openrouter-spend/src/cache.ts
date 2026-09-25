/**
 * Bounded TTL cache with in-flight de-duplication for one asynchronous load.
 * @module @deepseek-ai/dsh-openrouter-spend/cache
 */

interface CacheSlot<T> {
  readonly value: T
  readonly fetchedAt: number
}

/**
 * One cached value and the in-flight load that fetched it.
 * `read` returns the cached value while it is fresh; a fresh cache and a
 * running load are distinct states, so both are kept.
 */
export class TtlCache<T> {
  private readonly ttlMs: number
  private slot: CacheSlot<T> | null = null
  private inflight: Promise<T> | null = null

  /**
   * @param ttlMs - lifetime of one cached reading in milliseconds; must be a non-negative finite number.
   * @throws {RangeError} when the TTL is not a non-negative finite number (misconfiguration fails loud).
   */
  constructor(ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError(`cache TTL must be a non-negative finite number, got ${String(ttlMs)}`)
    }
    this.ttlMs = ttlMs
  }

  /**
   * Return the fresh cached value, or load one. Concurrent callers sharing a
   * stale or absent cache share the single in-flight load; a rejected load
   * clears the slot so the next read retries.
   * @param load - the operation that fetches a fresh value when the cache is stale or empty.
   * @returns the fresh or just-fetched value.
   */
  read(load: () => Promise<T>): Promise<T> {
    if (this.slot !== null && Date.now() - this.slot.fetchedAt < this.ttlMs) {
      return Promise.resolve(this.slot.value)
    }
    if (this.inflight !== null) return this.inflight
    this.inflight = load().then(
      (value) => {
        this.inflight = null
        this.slot = { value, fetchedAt: Date.now() }
        return value
      },
      (error: unknown) => {
        this.inflight = null
        throw error
      },
    )
    return this.inflight
  }
}
