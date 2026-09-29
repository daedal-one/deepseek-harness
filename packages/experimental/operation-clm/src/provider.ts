/**
 * CLM System One ranking provider with exact tokenizer accounting and drainable cancellation.
 * @module @deepseek-ai/dsh-experimental-operation-clm/provider
 */

import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  canonicalJson,
  type OperationDeploymentManifestVerification,
  type OperationJudgmentDraft,
  type OperationJudgmentIdentity,
  type OperationJudgmentProvider,
  type OperationJudgmentResponse,
  type OperationPreparedJudgment,
  type OperationTokenizer,
} from '@deepseek-ai/dsh-experimental-operation'
import { clmChoiceRequest, clmEncoderInputs, ClmWireError, parseClmChoiceResponse, serializeClmChoice } from './wire.ts'

/**

 * Fully resolved CLM HTTP provider configuration.

 */
export interface ClmHttpConfig {
  /**
   * Exact absolute HTTPS System One endpoint.
   */
  readonly endpoint: string
  /**
   * Registered tokenizer hook identity.
   */
  readonly tokenizerId: string
  /**
   * Immutable ranking model identity.
   */
  readonly model: string
  /**
   * Immutable encoder identity.
   */
  readonly encoder: string
  /**
   * Immutable deployment/artifact digest.
   */
  readonly deployment: string
  /**
   * Local deployment-manifest verification required for autonomous execution.
   */
  readonly deploymentManifest?: OperationDeploymentManifestVerification
  /**
   * Required calibration artifact identity when the operation policy enables it.
   */
  readonly calibrationId?: string
  /**
   * Credential reference name resolved by the composition for every HTTP request.
   */
  readonly credentialRef?: string
  /**
   * Provider route identity.
   */
  readonly providerId: string
  /**
   * Exact serialization recipe identifier.
   */
  readonly serialization: string
  /**
   * CLM softmax temperature sent on every request.
   */
  readonly temperature: number
  /**
   * Per-request cooperative HTTP deadline.
   */
  readonly timeoutMs: number
  /**
   * Maximum complete response body bytes; oversized bodies reject without truncation.
   */
  readonly maxResponseBytes: number
}

/**

 * Testable Fetch boundary.

 */
export type ClmFetch = (input: string, init: RequestInit) => Promise<Response>

/**

 * Optional per-request credential resolver.

 */
export type ClmCredentialResolver = () => Promise<string | undefined>

/**

 * CLM transport, timeout, body-bound, identity, credential, or lifecycle failure.

 */
export class ClmHttpError extends Error {
  /**
   * Machine-routable provider failure code.
   */
  readonly code: string

  /**

   * @param message Stable provider error detail.

   * @param code Machine-routable provider failure code.

   */
  constructor(message: string, code: string) {
    super(message)
    this.name = 'ClmHttpError'
    this.code = code
  }
}

/**

 * One drainable CLM System One provider.

 */
export class ClmHttpProvider implements OperationJudgmentProvider {
  /**
   * Immutable provider identity recorded before every HTTP dispatch.
   */
  readonly identity: OperationJudgmentIdentity
  private readonly active = new Map<AbortController, Promise<void>>()
  private disposed = false

  /**

   * @param config Resolved endpoint, identity, token, byte, and deadline caps.

   * @param tokenizer Exact configured tokenizer hook.

   * @param request HTTP transport, injected for protocol tests.

   * @param resolveCredential Optional composition-owned per-request credential lookup.

   */
  constructor(
    private readonly config: ClmHttpConfig,
    private readonly tokenizer: OperationTokenizer,
    private readonly request: ClmFetch = (input, init) => fetch(input, init),
    private readonly resolveCredential?: ClmCredentialResolver,
  ) {
    validateConfig(config, tokenizer)
    this.identity = {
      provider: config.providerId,
      model: config.model,
      encoder: config.encoder,
      tokenizer: config.tokenizerId,
      serialization: config.serialization,
      deployment: config.deployment,
      ...(config.deploymentManifest === undefined ? {} : { deploymentManifest: config.deploymentManifest }),
      ...(config.calibrationId === undefined ? {} : { calibrationId: config.calibrationId }),
    }
  }

  /**

   * Build the exact System One body and count each actual encoder input through the matching tokenizer.

   * @param draft Runner-owned closed candidate request.

   * @param signal Caller cancellation.

   * @returns Prepared request with exact local input token count.

   */
  async prepare(draft: OperationJudgmentDraft, signal: AbortSignal): Promise<OperationPreparedJudgment> {
    this.assertLive()
    if (signal.aborted) throw new ClmHttpError('CLM request preparation was cancelled', 'CLM_CANCELLED')
    const wire = clmChoiceRequest(draft, this.identity, this.config.temperature)
    let inputTokens = 0
    for (const text of clmEncoderInputs(wire)) {
      try {
        inputTokens += await this.tokenizer.count(text, signal)
      } catch (error: unknown) {
        throwIfAborted(signal, 'CLM request preparation was cancelled')
        throw new ClmHttpError(`CLM tokenizer failed: ${message(error)}`, 'CLM_TOKENIZER')
      }
      throwIfAborted(signal, 'CLM request preparation was cancelled')
    }
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) throw new ClmHttpError('CLM tokenizer returned an invalid token count', 'CLM_TOKENIZER')
    return { draft, wire: wire as unknown as import('@deepseek-ai/dsh-util-values').JsonValue, inputTokens, identity: this.identity }
  }

  /**

   * Send one prepared System One request and validate its complete response before returning it.

   * @param prepared Exact runner-recorded request.

   * @param signal Caller cancellation.

   * @returns Validated closed probability distribution.

   */
  async rank(prepared: OperationPreparedJudgment, signal: AbortSignal): Promise<OperationJudgmentResponse> {
    this.assertLive()
    const controller = new AbortController()
    const requestSignal = AbortSignal.any([signal, controller.signal])
    const task = this.rankRequest(prepared, requestSignal)
    const settling = task.then(() => undefined, () => undefined)
    this.active.set(controller, settling)
    try {
      return await task
    } finally {
      this.active.delete(controller)
    }
  }

  /**

   * Abort all owned requests and await their settlement before provider unload completes.

   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.active.keys()) controller.abort(new ClmHttpError('CLM provider is disposing', 'CLM_DISPOSED'))
    await Promise.allSettled(this.active.values())
    this.active.clear()
  }

  private async rankRequest(prepared: OperationPreparedJudgment, signal: AbortSignal): Promise<OperationJudgmentResponse> {
    if (canonicalJson(prepared.identity as unknown as import('@deepseek-ai/dsh-util-values').JsonValue) !== canonicalJson(this.identity as unknown as import('@deepseek-ai/dsh-util-values').JsonValue)) {
      throw new ClmHttpError('CLM prepared request identity does not match this provider', 'CLM_IDENTITY')
    }
    const expected = clmChoiceRequest(prepared.draft, this.identity, this.config.temperature)
    if (canonicalJson(prepared.wire) !== canonicalJson(expected as unknown as import('@deepseek-ai/dsh-util-values').JsonValue)) {
      throw new ClmHttpError('CLM prepared request wire does not match pinned System One protocol', 'CLM_WIRE')
    }
    const body = serializeClmChoice(expected)
    using d = deadline(signal, this.config.timeoutMs, 'CLM_HTTP_TIMEOUT')
    let response: Response
    try {
      response = await this.request(this.config.endpoint, {
        method: 'POST',
        headers: await this.headers(),
        body,
        signal: d.signal,
      })
    } catch (error: unknown) {
      if (error instanceof ClmHttpError) throw error
      throw this.transportError(error, d.signal)
    }
    let text: string
    try {
      text = await readBody(response, this.config.maxResponseBytes, d.signal)
    } catch (error: unknown) {
      if (error instanceof ClmHttpError) throw error
      throw this.transportError(error, d.signal)
    }
    if (response.status !== 200) throw new ClmHttpError(`CLM endpoint returned HTTP ${response.status}: ${text}`, 'CLM_HTTP_STATUS')
    requireJsonContentType(response)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error: unknown) {
      throw new ClmHttpError(`CLM endpoint returned incomplete or invalid JSON: ${message(error)}`, 'CLM_WIRE')
    }
    try {
      return parseClmChoiceResponse(raw, prepared, this.identity)
    } catch (error: unknown) {
      if (error instanceof ClmWireError) throw new ClmHttpError(error.message, 'CLM_WIRE')
      throw error
    }
  }

  private async headers(): Promise<Record<string, string>> {
    const headers = { accept: 'application/json', 'content-type': 'application/json' }
    if (this.config.credentialRef === undefined) return headers
    if (this.resolveCredential === undefined) throw new ClmHttpError('CLM credential reference is configured but unavailable', 'CLM_CREDENTIAL')
    let secret: string | undefined
    try {
      secret = await this.resolveCredential()
    } catch {
      throw new ClmHttpError('CLM credential resolution failed', 'CLM_CREDENTIAL')
    }
    if (secret === undefined || secret.length === 0) throw new ClmHttpError('CLM credential is unavailable', 'CLM_CREDENTIAL')
    return { ...headers, authorization: `Bearer ${secret}` }
  }

  private assertLive(): void {
    if (this.disposed) throw new ClmHttpError('CLM provider is disposed', 'CLM_DISPOSED')
  }

  private transportError(error: unknown, signal: AbortSignal): ClmHttpError {
    if (this.disposed) return new ClmHttpError('CLM provider is disposing', 'CLM_DISPOSED')
    if (timeoutOf(signal, 'CLM_HTTP_TIMEOUT') !== undefined) return new ClmHttpError('CLM HTTP request timed out', 'CLM_TIMEOUT')
    if (signal.aborted) return new ClmHttpError('CLM HTTP request was cancelled', 'CLM_CANCELLED')
    return new ClmHttpError(`CLM HTTP request failed: ${message(error)}`, 'CLM_TRANSPORT')
  }
}

/**

 * Validate a provider config at the composition boundary.

 * @param config Candidate resolved config.

 * @param tokenizer Configured tokenizer hook.

 */
export function validateConfig(config: ClmHttpConfig, tokenizer: OperationTokenizer): void {
  let endpoint: URL
  try {
    endpoint = new URL(config.endpoint)
  } catch {
    throw new ClmHttpError('CLM endpoint must be an absolute URL', 'CLM_CONFIG')
  }
  const localHttp = endpoint.protocol === 'http:' && (endpoint.hostname === '127.0.0.1' || endpoint.hostname === '::1' || endpoint.hostname === 'localhost')
  if (endpoint.protocol !== 'https:' && !localHttp) throw new ClmHttpError('CLM endpoint must use HTTPS outside local protocol tests', 'CLM_CONFIG')
  if (endpoint.pathname !== '/v1/systemone' || endpoint.search !== '' || endpoint.hash !== '') {
    throw new ClmHttpError('CLM endpoint must be the exact /v1/systemone URL', 'CLM_CONFIG')
  }
  for (const [name, value] of Object.entries(config)) {
    if ((name === 'timeoutMs' || name === 'maxResponseBytes') && (!Number.isSafeInteger(value) || value < 1)) {
      throw new ClmHttpError(`CLM ${name} must be a positive safe integer`, 'CLM_CONFIG')
    }
    if (typeof value === 'string' && value.length === 0) throw new ClmHttpError(`CLM ${name} must be non-empty`, 'CLM_CONFIG')
  }
  if (!Number.isFinite(config.temperature) || config.temperature <= 0 || config.temperature > 100) {
    throw new ClmHttpError('CLM temperature must be finite within (0, 100]', 'CLM_CONFIG')
  }
  if (config.deploymentManifest !== undefined) validateManifest(config.deploymentManifest)
  if (tokenizer.id !== config.tokenizerId) throw new ClmHttpError('CLM tokenizer hook identity does not match tokenizerId', 'CLM_CONFIG')
}

async function readBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/u.test(contentLength) || Number(contentLength) > maxBytes) {
      await response.body?.cancel()
      throw new ClmHttpError(`CLM response content-length exceeds ${maxBytes} bytes`, 'CLM_BODY_LIMIT')
    }
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const cancel = (): void => { void reader.cancel(signal.reason).catch(() => undefined) }
  if (signal.aborted) {
    cancel()
    throw new ClmHttpError('CLM response body read was cancelled', 'CLM_CANCELLED')
  }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const entry = await reader.read()
      if (entry.done) break
      bytes += entry.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new ClmHttpError(`CLM response body exceeds ${maxBytes} bytes`, 'CLM_BODY_LIMIT')
      }
      chunks.push(entry.value)
      throwIfAborted(signal, 'CLM response body read was cancelled')
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  return new TextDecoder().decode(joinChunks(chunks, bytes))
}

function throwIfAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) throw new ClmHttpError(message, 'CLM_CANCELLED')
}

function validateManifest(manifest: OperationDeploymentManifestVerification): void {
  if (manifest.reference.length === 0 || manifest.digest.length === 0) {
    throw new ClmHttpError('CLM deploymentManifest reference and digest must be non-empty', 'CLM_CONFIG')
  }
}

function joinChunks(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

function requireJsonContentType(response: Response): void {
  const contentType = response.headers.get('content-type')
  if (contentType === null || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new ClmHttpError('CLM endpoint must return application/json', 'CLM_CONTENT_TYPE')
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
