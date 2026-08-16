import type { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolPolicyDecision, ToolPolicyProviderId } from './index.ts'

/** Durable classifier request fields, recorded before adapter dispatch. */
export interface ToolPolicyClassifierRequestEventData {
  readonly turn: number
  readonly callId: CallId
  readonly providerId: ToolPolicyProviderId
  readonly route: { readonly provider: string; readonly model: string }
  readonly request: {
    readonly system: string
    readonly user: string
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
  readonly attempt?: { readonly number: number; readonly threshold: number; readonly spent: boolean }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact bounded auxiliary classifier request recorded before LLM dispatch. */
    'tool-policy/classifier-request': ToolPolicyClassifierRequestEventData
    /** Provider or effective authorization decision; raw arguments remain in `tool/call`. */
    'tool-policy/decision': ToolPolicyDecisionEventData
  }
}
