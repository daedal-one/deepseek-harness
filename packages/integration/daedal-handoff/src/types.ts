/** Model-visible handoff outcome, excluding destination credentials. @module */
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Receipt or refusal produced by one confirmed handoff attempt. */
export interface HandoffResult {
  status: 'unavailable' | 'declined' | 'started' | 'unknown'
  message: string
  sessionId?: SessionId
  destination?: string
  destinationUrl?: string
}
