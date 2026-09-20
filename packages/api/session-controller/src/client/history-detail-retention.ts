/** Host-wide accounting for explicitly hydrated history entries. */
import type { HistoryDetailRetentionPolicy } from './platform.ts'

/** An exact entry exceeds the caller's retained-detail allowance; its compact entry is unchanged. */
export class HistoryDetailLimitError extends Error {
  /**
   * @param serializedChars - complete JSON entry length in UTF-16 code units.
   * @param maxSerializedChars - configured Host-wide allowance in the same units.
   */
  constructor(readonly serializedChars: number, readonly maxSerializedChars: number) {
    super(`History detail requires ${String(serializedChars)} serialized characters; limit is ${String(maxSerializedChars)}`)
    this.name = 'HistoryDetailLimitError'
  }
}

interface RetainedDetail {
  readonly chars: number
  readonly evict: () => void
}

/** Oldest-hydration eviction shared by every resident Session of one Host connection. */
export class HistoryDetailRetention {
  private readonly entries = new Set<RetainedDetail>()
  private chars = 0
  private readonly maxSerializedChars: number

  /** @param policy - positive serialized-character limit validated at Client composition. */
  constructor(policy: HistoryDetailRetentionPolicy) {
    if (!Number.isSafeInteger(policy.maxSerializedChars) || policy.maxSerializedChars <= 0) {
      throw new Error('historyDetailRetention.maxSerializedChars must be a positive safe integer')
    }
    this.maxSerializedChars = policy.maxSerializedChars
  }

  /**
   * Admit one complete entry, restoring older compact entries until it fits.
   * @param chars - complete JSON entry length in UTF-16 code units.
   * @param evict - synchronously restore this entry's compact projection.
   * @returns an idempotent release that removes accounting without invoking eviction.
   */
  retain(chars: number, evict: () => void): () => void {
    if (chars > this.maxSerializedChars) throw new HistoryDetailLimitError(chars, this.maxSerializedChars)
    while (this.chars + chars > this.maxSerializedChars) {
      const oldest = this.entries.values().next().value as RetainedDetail
      this.remove(oldest)
      oldest.evict()
    }
    const entry = { chars, evict }
    this.entries.add(entry)
    this.chars += chars
    return () => { this.remove(entry) }
  }

  private remove(entry: RetainedDetail): void {
    if (this.entries.delete(entry)) this.chars -= entry.chars
  }
}
