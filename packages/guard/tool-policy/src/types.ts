import type { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolPolicyDecision, ToolPolicyProviderId } from './index.ts'

/** Purpose of one auxiliary tool-policy request. */
export type ToolPolicyClassifierPurpose = 'intent' | 'effect-primary' | 'effect-secondary'

/** Durable selectors and bounds needed to reconstruct one auxiliary input. */
export type ToolPolicyClassifierInput =
  | {
    readonly kind: 'intent'
    readonly userMessageSeq?: number
    readonly intentArgument?: string
    readonly maxUserMessageChars: number
    readonly maxIntentChars: number
  }
  | {
    readonly kind: 'effect'
    readonly commandArgument: string
    readonly maxCommandChars: number
  }

/** Durable classifier request fields, recorded before adapter dispatch. */
export interface ToolPolicyClassifierRequestEventData {
  readonly turn: number
  readonly callId: CallId
  readonly providerId: ToolPolicyProviderId
  readonly route: { readonly provider: string; readonly model: string }
  readonly purpose: ToolPolicyClassifierPurpose
  readonly input: ToolPolicyClassifierInput
  readonly request: {
    readonly system: string
    readonly temperature: 0
    readonly maxTokens: number
  }
}

/** Durable provider or effective decision without duplicated tool arguments. */
export interface ToolPolicyDecisionEventData {
  readonly turn: number
  readonly callId: CallId
  readonly toolName: string
  readonly stage: 'provider' | 'effective'
  readonly policyDecision: ToolPolicyDecision
  readonly effectiveDecision: ToolPolicyDecision
  readonly providerId: ToolPolicyProviderId
  readonly risk: number
  readonly categories: readonly string[]
  readonly reason: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Reconstructible bounded auxiliary request recorded before LLM dispatch. */
    'tool-policy/classifier-request': ToolPolicyClassifierRequestEventData
    /** Provider or effective authorization decision; raw arguments remain in `tool/call`. */
    'tool-policy/decision': ToolPolicyDecisionEventData
  }
}
