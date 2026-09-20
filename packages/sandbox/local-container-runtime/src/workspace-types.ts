/** Durable workspace outcomes shared by host and client projections. @module */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Message } from '@deepseek-ai/dsh-llm/types'

/** Host-generated identity for one conversation repository. */
export type ConversationWorkspaceId = Branded<'ConversationWorkspaceId'>

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
    /** Workspace identity and synchronization facts; never inserts agent messages. */
    'workspace/state': WorkspaceState
    /** Exact bounded auxiliary request recorded before dispatch. */
    'workspace/commit-message-request': { turn: number; system: string; messages: Message[]; provider: string; model: string; maxTokens: number }
  }
}
