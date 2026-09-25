/**
 * OpenRouter network boundary: the two GET endpoints the spend service reads.
 * Every exported failure keeps the credential out of `detail`.
 * @module @deepseek-ai/dsh-openrouter-spend/openrouter
 */

import { parseKeyReply, parseModelsReply, type OpenRouterModelCatalogEntry } from './api.ts'
import type { OpenRouterKeyUsage, OpenRouterSpendFailure } from './types.ts'

/** Options for one OpenRouter read operation. */
export interface OpenRouterReadOptions {
  /** OpenRouter endpoint base; `/key` and `/models` are appended. */
  readonly baseURL: string
  /** The configured OpenRouter inference key; sent only in the Authorization header. */
  readonly apiKey: string
  /** Upper bound on one OpenRouter request, in milliseconds. */
  readonly requestTimeoutMs: number
}

/** Result of one OpenRouter `GET /key` read. */
export type OpenRouterKeyReadResult =
  | { readonly ok: true; readonly value: OpenRouterKeyUsage }
  | { readonly ok: false; readonly error: OpenRouterSpendFailure }

/** Result of one OpenRouter `GET /models` read. */
export type OpenRouterModelsReadResult =
  | { readonly ok: true; readonly value: readonly OpenRouterModelCatalogEntry[] }
  | { readonly ok: false; readonly error: OpenRouterSpendFailure }

/** Attribution header sent on every request; bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.1.5-alpha.2'

/**
 * Read one JSON endpoint of OpenRouter and run its parser.
 * @param endpoint - full URL to fetch.
 * @param options - the endpoint base, key, and request bound.
 * @param signal - caller cancellation for the request.
 * @param parser - the pure body parser for this endpoint.
 * @param apiKey - optional inference credential, sent only to the key endpoint.
 * @returns the parsed value, or the mapped failure.
 */
async function readEndpoint<T>(
  endpoint: string,
  options: Pick<OpenRouterReadOptions, 'requestTimeoutMs'>,
  signal: AbortSignal,
  parser: (payload: unknown) => { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string },
  apiKey?: string,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: OpenRouterSpendFailure }> {
  const timeout = AbortSignal.timeout(options.requestTimeoutMs)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      signal: AbortSignal.any([signal, timeout]),
    })
  } catch (error) {
    // A thrown fetch covers caller abort, timeout abort, DNS, and network failure alike;
    // none of them carries a useful URL, and none may leak the key.
    const detail = signal.aborted
      ? 'request aborted before OpenRouter answered'
      : timeout.aborted
        ? `request timed out after ${String(options.requestTimeoutMs)} ms`
        : `request failed: ${error instanceof Error ? error.name : 'unknown error'}`
    return { ok: false, error: { reason: 'unreachable', detail } }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: { reason: 'unauthorized', detail: `OpenRouter rejected the key with HTTP ${String(response.status)}` } }
  }
  if (response.status === 429) {
    return { ok: false, error: { reason: 'rate-limited', detail: 'OpenRouter rate-limited the request (HTTP 429)' } }
  }
  if (!response.ok) {
    return { ok: false, error: { reason: 'unreachable', detail: `OpenRouter answered with HTTP ${String(response.status)}` } }
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    // Swallowed: a body that is not JSON cannot be interpreted; the status already proved OpenRouter answered.
    return { ok: false, error: { reason: 'malformed-response', detail: 'OpenRouter returned a non-JSON body' } }
  }
  const parsed = parser(payload)
  if (!parsed.ok) return { ok: false, error: { reason: 'malformed-response', detail: parsed.detail } }
  return { ok: true, value: parsed.value }
}

/**
 * Read the configured key's usage from `GET {baseURL}/key`.
 * @param options - the endpoint base, key, and request bound.
 * @param signal - caller cancellation for the request.
 * @returns the parsed key usage, or the mapped failure.
 */
export function readKeyUsage(
  options: OpenRouterReadOptions,
  signal: AbortSignal,
): Promise<OpenRouterKeyReadResult> {
  return readEndpoint(endpointOf(options.baseURL, 'key'), options, signal, parseKeyReply, options.apiKey)
}

/**
 * Read the public model catalog from `GET {baseURL}/models`.
 * @param options - the endpoint base and request bound for the public catalog read.
 * @param signal - caller cancellation for the request.
 * @returns the parsed catalog, or the mapped failure.
 */
export function readModels(
  options: Pick<OpenRouterReadOptions, 'baseURL' | 'requestTimeoutMs'>,
  signal: AbortSignal,
): Promise<OpenRouterModelsReadResult> {
  return readEndpoint(endpointOf(options.baseURL, 'models'), options, signal, parseModelsReply)
}

/**
 * Append one path segment to the endpoint base.
 * @param baseURL - the configured base, with any trailing slash removed.
 * @param segment - the path segment to append.
 * @returns the full endpoint URL.
 */
function endpointOf(baseURL: string, segment: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/${segment}`
}
