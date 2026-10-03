/**
 * Bounded local JSON transport shared by the tokenizer hook and private decision provider.
 * @module @deepseek-ai/dsh-experimental-operation-clm/local-http
 */

import { createHash } from 'node:crypto'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { deepFreeze, type JsonValue } from '@deepseek-ai/dsh-util-values'

export { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Explicit local transport limits; no retries, redirects, queue, or remote endpoints. */
export interface LocalHttpConfig {
  readonly endpoint: string
  readonly credentialRef?: string
  readonly timeoutMs: number
  readonly maxRequestBytes: number
  readonly maxResponseBytes: number
  readonly maxConcurrentRequests: number
}

/** Sanitized local transport failure; never carries response bodies or credential errors. */
export class LocalHttpError extends Error {
  /** @param message Safe diagnostic. @param code Stable failure code. */
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'LocalHttpError'
  }
}

/**
 * Digest exact UTF-8 text, without JSON normalization or independent field hashing.
 * @param text Exact source text.
 * @returns Version-one protocol digest.
 */
export function utf8Digest(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/** Drainable Fetch client for the private local service protocol. */
export class LocalHttpClient {
  private readonly config: LocalHttpConfig
  private readonly active = new Map<AbortController, Promise<unknown>>()
  private disposal: Promise<void> | undefined

  /** @param config Explicit local endpoint and bounds. @param resolveCredential Per-request secret lookup. */
  constructor(config: LocalHttpConfig, private readonly resolveCredential?: () => Promise<string | undefined>) {
    let endpoint: URL
    try { endpoint = new URL(config.endpoint) } catch { throw new LocalHttpError('local endpoint must be an absolute HTTP origin', 'LOCAL_CONFIG') }
    if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::[0-9]+)?\/?$/u.test(config.endpoint)
      || endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)
      || endpoint.username !== '' || endpoint.password !== '' || endpoint.pathname !== '/' || endpoint.search !== '' || endpoint.hash !== '') {
      throw new LocalHttpError('local endpoint must be a loopback HTTP origin without credentials, path, query, or fragment', 'LOCAL_CONFIG')
    }
    for (const key of ['timeoutMs', 'maxRequestBytes', 'maxResponseBytes', 'maxConcurrentRequests'] as const) {
      if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new LocalHttpError(`local ${key} must be a positive safe integer`, 'LOCAL_CONFIG')
    }
    if (config.timeoutMs > MAX_TIMER_DELAY_MS) throw new LocalHttpError('local timeout exceeds the supported timer range', 'LOCAL_CONFIG')
    if (config.credentialRef !== undefined && config.credentialRef.length === 0) throw new LocalHttpError('local credential reference must be non-empty', 'LOCAL_CONFIG')
    this.config = deepFreeze({ ...config, endpoint: endpoint.origin })
  }

  /**
   * Send one complete bounded JSON request; disposal retains ownership through body settlement.
   * @param path Protocol-owned absolute route.
   * @param body Complete wire envelope.
   * @param signal Caller cancellation.
   * @returns Complete decoded JSON value, still requiring protocol validation.
   */
  async post(path: string, body: JsonValue, signal: AbortSignal): Promise<unknown> {
    if (this.disposal !== undefined) throw new LocalHttpError('local client is disposed', 'LOCAL_DISPOSED')
    if (this.active.size >= this.config.maxConcurrentRequests) throw new LocalHttpError('local request admission limit exceeded', 'LOCAL_BUSY')
    if (!/^\/v1\/[a-z]+$/u.test(path)) throw new LocalHttpError('unsupported local protocol route', 'LOCAL_CONFIG')
    const text = JSON.stringify(body)
    if (Buffer.byteLength(text, 'utf8') > this.config.maxRequestBytes) throw new LocalHttpError('local request body exceeds configured byte limit', 'LOCAL_BODY_LIMIT')
    const controller = new AbortController()
    const task = Promise.resolve().then(async () => {
      using timer = deadline(AbortSignal.any([signal, controller.signal]), this.config.timeoutMs, 'LOCAL_HTTP_TIMEOUT')
      try {
        timer.signal.throwIfAborted()
        const headers = await this.headers()
        timer.signal.throwIfAborted()
        const response = await fetch(`${this.config.endpoint}${path}`, { method: 'POST', redirect: 'error', headers, body: text, signal: timer.signal })
        if (response.status !== 200) {
          await response.body?.cancel()
          throw new LocalHttpError(`local endpoint returned HTTP ${response.status}`, 'LOCAL_HTTP_STATUS')
        }
        if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) {
          await response.body?.cancel()
          throw new LocalHttpError('local endpoint must return application/json', 'LOCAL_CONTENT_TYPE')
        }
        const raw = await readBody(response, this.config.maxResponseBytes, timer.signal)
        timer.signal.throwIfAborted()
        try { return JSON.parse(raw) as unknown } catch { throw new LocalHttpError('local endpoint returned invalid or incomplete JSON', 'LOCAL_WIRE') }
      } catch (error: unknown) {
        if (this.disposal !== undefined) throw new LocalHttpError('local client is disposing', 'LOCAL_DISPOSED')
        if (timeoutOf(timer.signal, 'LOCAL_HTTP_TIMEOUT') !== undefined) throw new LocalHttpError('local HTTP request timed out', 'LOCAL_TIMEOUT')
        if (timer.signal.aborted) throw new LocalHttpError('local HTTP request was cancelled', 'LOCAL_CANCELLED')
        if (error instanceof LocalHttpError) throw error
        throw new LocalHttpError('local HTTP request failed', 'LOCAL_TRANSPORT')
      }
    })
    this.active.set(controller, task)
    try { return await task } finally { this.active.delete(controller) }
  }

  /** Stop admission synchronously, abort owned requests, and await their settlement. */
  async dispose(): Promise<void> {
    this.disposal ??= Promise.resolve().then(async () => {
      for (const controller of this.active.keys()) controller.abort()
      await Promise.allSettled(this.active.values())
    })
    await this.disposal
  }

  private async headers(): Promise<Headers> {
    const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' })
    if (this.config.credentialRef === undefined) return headers
    let secret: string | undefined
    try { secret = await this.resolveCredential?.() } catch { throw new LocalHttpError('local credential resolution failed', 'LOCAL_CREDENTIAL') }
    if (secret === undefined || secret.length === 0) throw new LocalHttpError('local credential is unavailable', 'LOCAL_CREDENTIAL')
    if (/[\r\n]/u.test(secret)) throw new LocalHttpError('local credential cannot be encoded as an HTTP header', 'LOCAL_CREDENTIAL')
    try { headers.set('authorization', `Bearer ${secret}`) } catch { throw new LocalHttpError('local credential cannot be encoded as an HTTP header', 'LOCAL_CREDENTIAL') }
    return headers
  }
}

async function readBody(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^(0|[1-9][0-9]*)$/u.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limit)) {
    await response.body?.cancel()
    throw new LocalHttpError('local response content-length exceeds configured byte limit', 'LOCAL_BODY_LIMIT')
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  let cancellation: Promise<void> | undefined
  const cancel = (): void => {
    cancellation ??= reader.cancel().catch(() => {
      // Fetch cancellation can reject after its stream has already failed.
    })
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) cancel()
    for (;;) {
      signal.throwIfAborted()
      const entry = await reader.read()
      if (entry.done) break
      size += entry.value.byteLength
      if (size > limit) {
        cancel()
        throw new LocalHttpError('local response body exceeds configured byte limit', 'LOCAL_BODY_LIMIT')
      }
      chunks.push(entry.value)
    }
    signal.throwIfAborted()
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)) } catch { throw new LocalHttpError('local response is not valid UTF-8', 'LOCAL_WIRE') }
  } finally {
    signal.removeEventListener('abort', cancel)
    await cancellation
    reader.releaseLock()
  }
}
