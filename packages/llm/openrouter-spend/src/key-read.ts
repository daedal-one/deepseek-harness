/**
 * OpenRouter key-usage read: the authenticated half of the spend report's
 * network boundary. The public catalog read and the shared endpoint helper
 * live in `@deepseek-ai/dsh-openrouter-catalog`.
 *
 * @module @deepseek-ai/dsh-openrouter-spend/key-read
 */

import { endpointOf, readEndpoint } from '@deepseek-ai/dsh-openrouter-catalog'
import type { OpenRouterReadOptions, OpenRouterReadResult } from '@deepseek-ai/dsh-openrouter-catalog'
import { parseKeyReply } from './key-parse.ts'
import type { OpenRouterKeyUsage } from './types.ts'

/** Result of one OpenRouter `GET /key` read. */
export type OpenRouterKeyReadResult = OpenRouterReadResult<OpenRouterKeyUsage>

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
