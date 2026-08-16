/** Durable English-output translation audit event types. */

import type { Message } from '@deepseek-ai/dsh-llm'

/** Exact provider/model identity. */
export interface ModelRoute {
  /** Registered LLM provider name. */
  readonly provider: string
  /** Exact model identifier exposed by the provider. */
  readonly model: string
}

/** One prose block selected for translation. */
export interface TranslationBlock {
  readonly index: number
  readonly type: 'text' | 'reasoning'
  readonly content: string
}

/** Stable, bounded classification of a failed translation attempt. */
export type TranslationFailureCode =
  | 'cancelled'
  | 'input-too-large'
  | 'invalid-json'
  | 'invalid-output'
  | 'provider-error'
  | 'timeout'

/** Result state recorded for one translation request. */
export type TranslationStatus = 'translated' | 'blocked' | 'preserved'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Exact auxiliary model input logged before translator dispatch. */
    'english-output/translation-request': {
      turn: number
      step: number
      target: ModelRoute
      translator: ModelRoute
      system: string
      messages: Message[]
      maxTokens: number
      blocks: TranslationBlock[]
    }
    /** Bounded settlement facts for one preceding translation request. */
    'english-output/translation-result': {
      turn: number
      step: number
      status: TranslationStatus
      blockIndexes: number[]
      failure?: { code: TranslationFailureCode }
    }
  }
}
