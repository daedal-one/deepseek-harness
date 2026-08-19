import type { CallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ToolPolicyDecision, ToolPolicyProviderId } from './index.ts'

/** Purpose of one auxiliary tool-policy request. */
export type ToolPolicyClassifierPurpose = 'intent-context' | 'effect-primary' | 'effect-secondary'

/** Durable selectors and bounds needed to reconstruct one auxiliary input. */
export type ToolPolicyClassifierInput =
  | {
    readonly kind: 'intent-context'
    readonly userMessageSeqs: readonly number[]
    readonly maxUserMessageChars: number
  }
  | {
    readonly kind: 'effect'
    readonly commandArgument: string
    readonly intentArgument?: string
    readonly intentContextSeq: number
    readonly maxCommandChars: number
    readonly maxIntentChars: number
  }

/** Durable classifier request fields, recorded before adapter dispatch. */
export interface ToolPolicyClassifierRequestEventData {
  readonly turn: number
  /** Present for tool-time effect requests; intent context starts before a tool call exists. */
  readonly callId?: CallId
  readonly providerId: ToolPolicyProviderId
  readonly route: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: ReasoningEffortId
  }
  readonly purpose: ToolPolicyClassifierPurpose
  readonly input: ToolPolicyClassifierInput
  readonly request: {
    readonly system: string
    readonly temperature: 0
    readonly maxTokens: number
    /** Wall-time bound for this auxiliary request. */
    readonly timeoutMs: number
  }
}

/** Validated short user-intent context reusable by later effect classifiers. */
export interface ToolPolicyIntentContextEventData {
  readonly turn: number
  readonly requestSeq: number
  readonly userMessageSeq: number
  readonly providerId: ToolPolicyProviderId
  readonly allowedEffects: readonly string[]
  readonly forbiddenEffects: readonly string[]
  readonly summary: string
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
    /** Validated user-intent context passed to later effect classifiers. */
    'tool-policy/intent-context': ToolPolicyIntentContextEventData
    /** Provider or effective authorization decision; raw arguments remain in `tool/call`. */
    'tool-policy/decision': ToolPolicyDecisionEventData
  }
}
