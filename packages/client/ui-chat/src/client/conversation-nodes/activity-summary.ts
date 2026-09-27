import type {
  ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client/portable'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ActivitySummaryEventData } from '@deepseek-ai/dsh-session-activity-summary-llm'
import type {} from '@deepseek-ai/dsh-session-activity-summary-llm'
import { chatNode } from './common.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Latest accepted model-generated activity summary for one Turn. */
    'activity-summary': import('../contract/chat-nodes.ts').ActivitySummaryChatData
  }
}

interface ActivitySummaryState {
  readonly event: SessionEvent<'activity-summary/update'>
}

function latestEvent(
  context: ConversationNodeContext<ActivitySummaryState>,
): SessionEvent<'activity-summary/update'> | undefined {
  if (context.state !== undefined) return context.state.event
  return context.matches.findLast(
    (match): match is typeof match & { event: SessionEvent<'activity-summary/update'> } =>
      match.event.type === 'activity-summary/update',
  )?.event
}

/** Consume model-visible request records without adding a Chat row. */
export const activitySummaryRequestDefinition: ConversationNodeDefinition = {
  kind: 'activity-summary-request',
  match: event => event.type === 'activity-summary/request'
    ? { id: `${event.data.turn}:${event.data.revision}`, role: 'start' }
    : null,
  start: () => ({}),
  update: context => context.state,
}

/** Latest-wins activity-summary Chat row. */
export const activitySummaryDefinition: ConversationNodeDefinition<ActivitySummaryState> = {
  kind: 'activity-summary',
  target: 'chat',
  match: event => event.type === 'activity-summary/update'
    ? { id: String(event.data.turn), role: event.data.revision === 1 ? 'start' : 'update' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'activity-summary/update') {
      throw new Error('activity-summary start requires activity-summary/update')
    }
    return { event: match.event }
  },
  update: (context, match) => match.event.type === 'activity-summary/update'
    ? { event: match.event }
    : context.state,
  buildViewNode: (context) => {
    const event = latestEvent(context)
    if (event === undefined) return null
    const data: ActivitySummaryEventData = event.data
    return chatNode(context, 'activity-summary', context.start?.event.seq ?? event.seq, data)
  },
}
