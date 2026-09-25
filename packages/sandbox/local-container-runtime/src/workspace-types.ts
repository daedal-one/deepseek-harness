/** Durable workspace outcomes shared by host and client projections. @module */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Message } from '@deepseek-ai/dsh-llm/types'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one repository return receipt. */
export type WorkspaceProvenanceId = Branded<'WorkspaceProvenanceId'>

/** Immutable host receipt; observed history does not assert conversation authorship. */
export interface WorkspaceProvenance {
  version: 1
  id: WorkspaceProvenanceId
  workspaceId: ConversationWorkspaceId
  sessionId: SessionId
  turn: number
  /** Inclusive owner-conversation event interval through the completed turn. */
  eventRange: [SessionSeq, SessionSeq]
  repository: string
  baseline: string
  createdAt: string
  refs: Array<{ source: string; branch: string; commit: string; topic: string }>
  /** Commits reachable from returned tips but not the imported baseline, plus the tips themselves. */
  observedCommits: string[]
  /** Only commits created by this Harness finalization transaction. */
  createdCommits: string[]
}

/** Host-generated identity for one conversation repository. */
export type ConversationWorkspaceId = Branded<'ConversationWorkspaceId'>

/** Identity of one turn's workspace admission request. */
export type WorkspaceAdmissionId = Branded<'WorkspaceAdmissionId'>

/** Durable execution waiting state, independent of conversation creation. */
export interface WorkspaceAdmissionState {
  id: WorkspaceAdmissionId
  status: 'waiting' | 'admitted' | 'cancelled' | 'failed'
  error?: string
}

/** Independently recorded synchronization outcome; model completion remains in turn/end. */
export interface WorkspaceState {
  workspaceId: ConversationWorkspaceId
  turn: number
  phase: 'ready' | 'saving' | 'returned' | 'checkpointed' | 'pending'
  baseline: string
  checkpoint: number
  checkpointHash: string
  branches: Record<string, string>
  error?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Execution capacity admission; never inserts model messages. */
    'workspace/admission': WorkspaceAdmissionState
    /** Workspace identity and synchronization facts; never inserts agent messages. */
    'workspace/state': WorkspaceState
    /** Exact bounded auxiliary request recorded before dispatch. */
    'workspace/commit-message-request': { turn: number; system: string; messages: Message[]; provider: string; model: string; maxTokens: number }
    /** Exact bounded naming input recorded before the auxiliary request. */
    'workspace/branch-name-request': { turn: number; system: string; messages: Message[]; provider: string; model: string; maxTokens: number }
    /** Host-persisted repository return metadata, independent of mutable branch names. */
    'workspace/provenance': WorkspaceProvenance
  }
}
