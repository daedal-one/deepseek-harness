import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable memory identifier shared by providers and Consumers. */
export type MemoryId = Branded<'MemoryId'>

/**
 * Construct a memory identifier at a validated persistence or creation boundary.
 * @param value - validated opaque identifier text.
 * @returns the branded memory identifier.
 */
export const MemoryId = (value: string): MemoryId => value as MemoryId

/** An explicit isolation domain for one memory operation. */
export type MemoryScope =
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'global' }

/** Evidence supporting or challenging a durable memory. */
export interface MemoryEvidence {
  readonly kind: 'session' | 'file' | 'url' | 'user' | 'agent' | 'tool'
  readonly ref: string
  readonly excerpt?: string
}

/** Confidence and provenance assigned to one memory revision. */
export interface MemoryTrust {
  readonly score: number
  readonly source: 'extracted' | 'agent' | 'user' | 'reviewer'
}

/** Optional interval during which the statement is expected to hold. */
export interface MemoryValidity { readonly validFrom?: number; readonly validUntil?: number }

/** Review lifecycle of a durable memory. */
export type MemoryStatus = 'proposed' | 'active' | 'challenged' | 'rejected' | 'superseded'

/** Complete durable memory record. */
export interface MemoryRecord {
  readonly id: MemoryId
  readonly revision: number
  readonly scope: MemoryScope
  readonly statement: string
  readonly status: MemoryStatus
  readonly evidence: readonly MemoryEvidence[]
  readonly trust: MemoryTrust
  readonly validity: MemoryValidity
  readonly contradicts: readonly MemoryId[]
  readonly challenge?: { readonly reason: string; readonly evidence: readonly MemoryEvidence[] }
  readonly supersededBy?: MemoryId
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastAccessedAt: number
  readonly accessCount: number
}

/** Compare-and-set reference used for review mutations. */
export interface MemoryRef { readonly scope: MemoryScope; readonly id: MemoryId; readonly revision: number }

/** New unreviewed statement. */
export interface MemoryProposal {
  readonly scope: MemoryScope
  readonly statement: string
  readonly evidence: readonly MemoryEvidence[]
  readonly trust: MemoryTrust
  readonly validity?: MemoryValidity
  readonly contradicts?: readonly MemoryId[]
}

/** Scope-bounded full-text lookup. */
export interface MemoryQuery {
  readonly scope: MemoryScope
  readonly text: string
  readonly statuses?: readonly MemoryStatus[]
  readonly limit?: number
  readonly at?: number
}

/** One query response, including provider-side truncation. */
export interface MemoryQueryResult { readonly memories: readonly MemoryRecord[]; readonly truncated: boolean }

/** Challenge one exact memory revision. */
export interface MemoryChallenge { readonly ref: MemoryRef; readonly reason: string; readonly evidence?: readonly MemoryEvidence[] }

/** Reviewer decision over one exact revision. */
export interface MemoryReview { readonly ref: MemoryRef; readonly decision: 'accept' | 'reject'; readonly trust?: MemoryTrust }

/** Atomically replace one memory with a reviewed successor. */
export interface MemorySupersession { readonly ref: MemoryRef; readonly replacement: MemoryProposal }

/** Record access to exact scope-bound memory revisions. */
export interface MemoryCheckpoint { readonly refs: readonly MemoryRef[] }

/** Storage implementation behind the memory Service Definition. */
export interface MemoryProvider {
  readonly id: string
  query(request: MemoryQuery): Promise<MemoryQueryResult>
  get(scope: MemoryScope, id: MemoryId): Promise<MemoryRecord | undefined>
  propose(request: MemoryProposal): Promise<MemoryRecord>
  challenge(request: MemoryChallenge): Promise<MemoryRecord>
  review(request: MemoryReview): Promise<MemoryRecord>
  supersede(request: MemorySupersession): Promise<{ readonly previous: MemoryRecord; readonly replacement: MemoryRecord }>
  checkpoint(request: MemoryCheckpoint): Promise<readonly MemoryRecord[]>
  delete(ref: MemoryRef): Promise<boolean>
}

/** Stable provider-neutral memory failure. */
export class MemoryError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'MemoryError' }
}
