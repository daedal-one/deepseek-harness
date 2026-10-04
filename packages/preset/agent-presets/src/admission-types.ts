/** Client-safe data vocabulary for operator-owned Session placement admission. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'

/** Lowercase SHA-256 digest of a logical Session prefix. */
export type SessionAdmissionSha256 = Branded<'SessionAdmissionSha256'>

/** Immutable logical prefix approved by the operator; later events are not fingerprinted. */
export interface SessionAdmissionPrefix {
  /** Canonical logical JSON encoding used for the digest. */
  readonly encoding: 'logical-json-v1'
  /** Current Session format of the hashed logical events. */
  readonly formatVersion: typeof SESSION_FORMAT_VERSION
  /** Immutable original prefix length; later events remain outside the digest. */
  readonly eventCount: number
  /** SHA-256 digest of the domain-separated canonical prefix. */
  readonly sha256: SessionAdmissionSha256
}

/** Exact restored identity and prefix allowed to use an execution-only host wrapper. */
export interface SessionAdmission {
  /** Exact Session identity approved by the operator. */
  readonly sessionId: SessionId
  /** Original logical preset; the selected projection must still match. */
  readonly agentPreset: string
  /** Creation timestamp recorded in the Session header. */
  readonly createdAt: number
  /** Literal cwd recorded in the Session header. */
  readonly cwd: string
  /** Direct parent Session ID, or null when absent. */
  readonly parentSession: SessionId | null
  /** Subagent origin, or null when absent. */
  readonly origin: 'subagent' | null
  /** Delegation depth, or null when absent rather than zero. */
  readonly delegationDepth: number | null
  /** Whether the Session was created with an inherited seed. */
  readonly isSeeded: boolean
  /** Inherited event count stored separately from the header. */
  readonly inheritedEventCount: SessionLogOffset
  /** Original immutable logical history approved by digest. */
  readonly prefix: SessionAdmissionPrefix
  /** System-trusted execution-only preset installed after validation. */
  readonly compositionPreset: string
}

/** Current logical storage data, usable before an Agent or live Session exists. */
export interface SessionCompositionSource {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffset
  readonly events: readonly SessionEvent[]
}
