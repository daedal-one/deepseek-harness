/** Platform-owned inputs for a single host's Client Session composition. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionRequestId } from '../types.ts'

/** Request identity and device time zone sampled by Session commands. */
export interface SessionPlatform {
  /** @returns a fresh, collision-resistant identity for one submitted command. */
  createRequestId(): SessionRequestId
  /** @returns the current device IANA time zone to record with a prompt. */
  timeZone(): string
}

/** Navigation restored only for the host that owns these Session identities. */
export interface SessionSelection {
  sessionId?: SessionId
  subagentAddress?: SubagentAddress
}

/** Caller-owned preferences, hydrated and validated before Session installation. */
export interface SessionSelectionStore {
  /** @returns the current selection for this host. */
  getSnapshot(): SessionSelection
  /**
   * Replace this host's selection; asynchronous persistence stays caller-owned.
   * @param selection - validated navigation projected by the Session service.
   */
  set(selection: SessionSelection): void
}

/** Optional bound on complete hydrated entries across every resident Session of one Host. */
export interface HistoryDetailRetentionPolicy {
  /** Positive safe integer counting JSON UTF-16 code units, including the entry envelope; not heap bytes. */
  readonly maxSerializedChars: number
}

/** Inputs owned by one host connection, never shared between independent hosts. */
export interface SessionClientOptions {
  platform: SessionPlatform
  /** Omission leaves hydrated details unbounded in the accepted event window. */
  historyDetailRetention?: HistoryDetailRetentionPolicy
  /** Persistence failures must not throw through a Session state notification. */
  selection: SessionSelectionStore
}
