/**
 * Cordis judgment and tokenizer registries for operation providers.
 * @module @deepseek-ai/dsh-experimental-operation/judgment
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { OperationJudgmentProvider, OperationTokenizer } from './types.ts'

/**

 * Operation judgment registry unavailable or misconfigured error.

 */
export class OperationJudgmentError extends Error {
  /**
   * @param message Stable provider/tokenizer availability diagnostic.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationJudgmentError'
  }
}

/**

 * Narrow provider and tokenizer service seam used by the sequential runner.

 */
export class OperationJudgmentRegistry extends Service {
  private provider: OperationJudgmentProvider | undefined
  private readonly tokenizers = new Map<string, OperationTokenizer>()

  /**

   * @param ctx Owning Cordis context.

   */
  constructor(ctx: Context) {
    super(ctx, 'operationJudgments')
  }

  /**

   * Register the sole ranking provider for this composition.

   * @param provider Provider with pinned identity.

   * @returns Disposer removing this exact provider.

   */
  registerProvider(provider: OperationJudgmentProvider): () => void {
    if (this.provider !== undefined) throw new OperationJudgmentError('operation judgment provider is already registered')
    this.provider = provider
    return () => {
      if (this.provider === provider) this.provider = undefined
    }
  }

  /**

   * Return the configured provider or fail before any operation effect.

   * @returns The sole configured ranking provider.

   */
  requireProvider(): OperationJudgmentProvider {
    if (this.provider === undefined) throw new OperationJudgmentError('operation judgment provider is not configured')
    return this.provider
  }

  /**

   * Register one exact tokenizer hook.

   * @param tokenizer Tokenizer implementation.

   * @returns Disposer removing this exact tokenizer.

   */
  registerTokenizer(tokenizer: OperationTokenizer): () => void {
    if (tokenizer.id.length === 0) throw new OperationJudgmentError('operation tokenizer id must be non-empty')
    if (this.tokenizers.has(tokenizer.id)) throw new OperationJudgmentError(`operation tokenizer ${JSON.stringify(tokenizer.id)} is already registered`)
    this.tokenizers.set(tokenizer.id, tokenizer)
    return () => {
      if (this.tokenizers.get(tokenizer.id) === tokenizer) this.tokenizers.delete(tokenizer.id)
    }
  }

  /**

   * Resolve an exact configured tokenizer hook.

   * @param id Tokenizer identity requested by provider configuration.

   * @returns Matching tokenizer.

   */
  requireTokenizer(id: string): OperationTokenizer {
    const tokenizer = this.tokenizers.get(id)
    if (tokenizer === undefined) throw new OperationJudgmentError(`operation tokenizer ${JSON.stringify(id)} is not configured`)
    return tokenizer
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    operationJudgments: OperationJudgmentRegistry
  }
}

export default OperationJudgmentRegistry
