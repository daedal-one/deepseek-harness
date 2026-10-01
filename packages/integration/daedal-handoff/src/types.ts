/** Model-visible handoff outcome, excluding destination credentials. @module */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { z } from 'zod'
import type { targetSchema } from './protocol.ts'

/** Receiver-owned target settings returned by authenticated discovery. */
export type HandoffTarget = z.infer<typeof targetSchema>

/** Receipt or refusal produced by one confirmed handoff attempt. */
export interface HandoffResult {
  status: 'targets' | 'unavailable' | 'declined' | 'started' | 'unknown'
  message: string
  sessionId?: SessionId
  destination?: string
  destinationUrl?: string
  /** Available profiles when no target was selected; discovery starts no work. */
  targets?: HandoffTarget[]
}
