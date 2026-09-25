/**
 * Bounded TTL cache with in-flight de-duplication for one asynchronous load.
 * @module @deepseek-ai/dsh-openrouter-spend/cache
 */

/** One value and the time its successful fetch completed. */
export interface CachedValue<T> {
  /** Loaded value. */
  readonly value: T
  /** Epoch milliseconds at which the load completed. */
  readonly fetchedAt: number
}

/**
 * One cached value and the in-flight load that fetched it.
 * `read` returns the cached value while it is fresh; a fresh cache and a
 * running load are distinct states, so both are kept.
 */
export class TtlCache<T> {
  private readonly ttlMs: number
  private slot: CachedValue<T> | null = null
  private inflight: Promise<CachedValue<T>> | null = null
  private generation = 0

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
   * Invalidate a value and prevent an older in-flight load from repopulating it.
   */
  clear(): void {
    this.generation += 1
    this.slot = null
    this.inflight = null
  }

  /**
   * Return the fresh cached value, or load one. Concurrent callers sharing a
   * stale or absent cache share the single in-flight load; non-cacheable values
   * and rejected loads leave no slot so the next read retries immediately.
   * @param load - the operation that fetches a fresh value when the cache is stale or empty.
   * @param cacheable - decides whether a successfully loaded value may occupy the cache.
   * @returns the fresh or just-fetched value with its actual fetch time.
   */
  read(load: () => Promise<T>, cacheable: (value: T) => boolean = () => true): Promise<CachedValue<T>> {
    if (this.slot !== null && Date.now() - this.slot.fetchedAt < this.ttlMs) {
      return Promise.resolve(this.slot)
    }
    if (this.inflight !== null) return this.inflight

    const generation = this.generation
    const loadPromise = load().then(value => ({ value, fetchedAt: Date.now() }))
    let inflight!: Promise<CachedValue<T>>
    inflight = loadPromise.then(
      (entry) => {
        if (this.inflight === inflight) this.inflight = null
        if (this.generation === generation && cacheable(entry.value)) this.slot = entry
        return entry
      },
      (error: unknown) => {
        if (this.inflight === inflight) this.inflight = null
        throw error
      },
    )
    this.inflight = inflight
    return inflight
  }
}
