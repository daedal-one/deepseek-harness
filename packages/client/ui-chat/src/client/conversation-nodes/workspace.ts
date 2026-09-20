import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client/portable'
import type { WorkspaceState } from '@deepseek-ai/dsh-local-container-runtime/workspace-types'
import { chatNode } from './common.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Workspace save outcome, separate from the model's turn result. */
    'workspace-state': WorkspaceState
  }
}

/** Turn-local save progress and the final branch-return receipt. */
export const workspaceDefinition: ConversationNodeDefinition<WorkspaceState | null> = {
  kind: 'workspace-state',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    return event.type === 'workspace/state' && event.data.phase !== 'ready'
      ? { id: String(event.data.turn), role: 'update' }
      : null
  },
  start: () => null,
  update: (context, match) => match.event.type === 'workspace/state' ? match.event.data : context.state,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const last = context.matches.at(-1)
    if (last?.event.type !== 'workspace/state') return null
    return chatNode(context, 'workspace-state', last.event.seq, last.event.data)
  },
}
