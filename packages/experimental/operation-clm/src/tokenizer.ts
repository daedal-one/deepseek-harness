/**
 * Exact local batch tokenizer hook for CLM encoder inputs; loads no model weights.
 * @module @deepseek-ai/dsh-experimental-operation-clm/tokenizer
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { OperationTokenizer } from '@deepseek-ai/dsh-experimental-operation'
import z from '@deepseek-ai/schemastery'
import { LocalHttpClient, LocalHttpError, MAX_TIMER_DELAY_MS, utf8Digest, type LocalHttpConfig } from './local-http.ts'

/** Cordis plugin name for the separately mounted tokenizer hook. */
export const name = 'operation-clm-tokenizer'

/** Registry owner required before tokenizer registration. */
export const inject = ['operations', 'credentials']

/** Explicit tokenizer identity and bounds, including every local transport limit. */
export interface Config extends LocalHttpConfig {
  /** Required bearer credential reference resolved for each local request. */
  readonly credentialRef: string
  /** Immutable deployed tokenizer and special-token recipe identity. */
  readonly tokenizerId: string
  /** Maximum independently encoded texts in one nonempty request. */
  readonly maxTexts: number
  /** Maximum complete token count accepted for each text, including special tokens. */
  readonly maxTokensPerText: number
}

/** Required Loader configuration; no deployment limits have implicit defaults. */
export const Config: z<Config> = z.object({
  endpoint: z.string().required(),
  credentialRef: z.string().required(),
  timeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).required(),
  maxRequestBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxResponseBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxConcurrentRequests: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
  tokenizerId: z.string().required(),
  maxTexts: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxTokensPerText: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

/** Validates exact request association before returning complete, independently encoded counts. */
export class LocalHttpTokenizer implements OperationTokenizer {
  readonly id: string
  private readonly config: Config
  private readonly client: LocalHttpClient

  /**
   * @param config Explicit local endpoint, tokenizer identity, and required limits.
   * @param resolveCredential Optional credential lookup performed for each HTTP request.
   */
  constructor(config: Config, resolveCredential?: () => Promise<string | undefined>) {
    if (typeof config.tokenizerId !== 'string' || config.tokenizerId.length === 0) {
      throw new LocalHttpError('tokenizerId must be non-empty', 'TOKENIZER_CONFIG')
    }
    for (const key of ['maxTexts', 'maxTokensPerText'] as const) {
      if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
        throw new LocalHttpError(`tokenizer ${key} must be a positive safe integer`, 'TOKENIZER_CONFIG')
      }
    }
    if (typeof config.credentialRef !== 'string') throw new LocalHttpError('tokenizer credentialRef is required', 'TOKENIZER_CONFIG')
    try { credentialRef(config.credentialRef) } catch {
      throw new LocalHttpError('tokenizer credential reference is invalid', 'TOKENIZER_CONFIG')
    }
    this.config = Object.freeze(structuredClone(config))
    this.id = this.config.tokenizerId
    this.client = new LocalHttpClient(this.config, resolveCredential)
  }

  /**
   * Count one exact text through the same batch protocol.
   * @param text Complete encoder input, without normalization or truncation.
   * @param signal Caller cancellation.
   * @returns Validated non-negative safe token count including deployed special tokens.
   */
  async count(text: string, signal: AbortSignal): Promise<number> {
    return (await this.countMany([text], signal))[0] as number
  }

  /**
   * Snapshot inputs before asynchronous work and reject incomplete or misassociated responses.
   * @param texts Nonempty exact encoder inputs, each encoded independently.
   * @param signal Caller cancellation.
   * @returns Frozen counts in original input order, each bounded by maxTokensPerText.
   */
  async countMany(texts: readonly string[], signal: AbortSignal): Promise<readonly number[]> {
    const inputs = [...texts]
    if (inputs.length < 1 || inputs.length > this.config.maxTexts) {
      throw new LocalHttpError('tokenizer text count exceeds configured bounds', 'TOKENIZER_INPUT_LIMIT')
    }
    const raw = await this.client.post('/v1/tokenize', { version: 1, tokenizer: this.id, texts: inputs }, signal)
    const response = exactObject(raw, ['version', 'tokenizer', 'counts'])
    if (response.version !== 1 || response.tokenizer !== this.id || !Array.isArray(response.counts)
      || response.counts.length !== inputs.length) {
      throw invalidResponse()
    }
    const entries = response.counts
    const counts = inputs.map((text, index) => {
      const entry = exactObject(entries[index], ['index', 'textDigest', 'tokens'])
      if (entry.index !== index || entry.textDigest !== utf8Digest(text)
        || typeof entry.tokens !== 'number' || !Number.isSafeInteger(entry.tokens) || entry.tokens < 0
        || entry.tokens > this.config.maxTokensPerText) {
        throw invalidResponse()
      }
      return entry.tokens
    })
    return Object.freeze(counts)
  }

  /** Stop admission, cancel owned HTTP requests, and wait for settlement. */
  async dispose(): Promise<void> {
    await this.client.dispose()
  }
}

/**
 * Register the exact tokenizer after operations and before the CLM provider.
 * @param ctx Composition context with the operation registry.
 * @param config Required tokenizer and local HTTP settings.
 */
export function apply(ctx: Context, config: Config): void {
  const reference = config.credentialRef
  const tokenizer = new LocalHttpTokenizer(config, async () => (await ctx.credentials.resolve(credentialRef(reference)))?.value)
  ctx.effect(() => {
    const unregister = ctx.operations.registerTokenizer(tokenizer)
    return async () => {
      unregister()
      await tokenizer.dispose()
    }
  }, 'operation-clm-tokenizer.registerTokenizer()')
}

function exactObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) {
    throw invalidResponse()
  }
  return raw as Record<string, unknown>
}

function invalidResponse(): LocalHttpError {
  return new LocalHttpError('tokenizer returned an invalid or mismatched response', 'TOKENIZER_WIRE')
}
