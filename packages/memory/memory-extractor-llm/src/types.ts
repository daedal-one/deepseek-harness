import type { ContentBlock, FinishReason, Message, TokenUsage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact durable pre-dispatch record for one post-turn memory extraction. */
    'memory/extraction-request': {
      turn: number
      sourceEventSeqs: number[]
      route: { provider: string; model: string }
      system: string
      messages: Message[]
      maxTokens: number
    }
    /** Exact assembled auxiliary response and bounded extraction settlement. */
    'memory/extraction-result': {
      turn: number
      blocks: ContentBlock[]
      finish: FinishReason
      usage?: TokenUsage
      proposedIds: string[]
      failure?: { code: 'aborted' | 'invalid-output' | 'provider-error' | 'queue-full' | 'timeout' }
    }
  }
}
