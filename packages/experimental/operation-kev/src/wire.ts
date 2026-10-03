/**
 * Version-one local preparation evidence and official System One response validation.
 * @module @deepseek-ai/dsh-experimental-operation-kev/wire
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { canonicalJson, type OperationJudgmentResponse, type OperationPreparedJudgment } from '@deepseek-ai/dsh-experimental-operation'
import { utf8Digest } from '@deepseek-ai/dsh-experimental-operation-clm/local-http'
import type { Config } from './config.ts'

/** Rejected remote evidence; messages exclude remote values. */
export class KevWireError extends Error {
  /** Stable malformed remote-evidence failure code. */
  readonly code = 'KEV_WIRE'
  /** @param message Safe protocol diagnostic. */
  constructor(message: string) { super(message); this.name = 'KevWireError' }
}

/**
 * Expected independently echoed manifest facts, separate from the HTTP route.
 * @param config Frozen reviewed deployment configuration.
 * @returns Protocol identity view.
 */
export function serviceIdentity(config: Config): JsonValue {
  return {
    model: config.model, wireModel: config.wireModel, encoder: config.encoder, tokenizer: config.tokenizerId,
    serialization: config.serialization, dtype: config.dtype, serviceCaps: { ...config.serviceCaps },
  }
}

/**
 * Validate complete official-encoder evidence and bind it to the exact request text.
 * @param raw Complete decoded preparation reply.
 * @param request Once-serialized official System One request.
 * @param config Frozen reviewed configuration.
 * @returns Complete version-one decision envelope, including ordered token evidence.
 */
export function parsePreparation(raw: unknown, request: string, config: Config): { wire: JsonValue; inputTokens: number } {
  const envelope = object(raw)
  exact(envelope, ['version', 'deployment', 'identity', 'preparation'])
  envelopeIdentity(envelope, config)
  const preparation = object(envelope.preparation)
  exact(preparation, ['requestDigest', 'tokenizer', 'serialization', 'inputTokens', 'maxInputTokens', 'tokenIds'])
  if (preparation.requestDigest !== utf8Digest(request) || preparation.tokenizer !== config.tokenizerId
    || preparation.serialization !== config.serialization) {
    throw new KevWireError('Kev preparation request or encoding identity mismatch')
  }
  const inputTokens = count(preparation.inputTokens)
  if (preparation.maxInputTokens !== config.serviceCaps.maxInputTokens || inputTokens > config.serviceCaps.maxInputTokens) {
    throw new KevWireError('Kev preparation exceeds or changes the reviewed input ceiling')
  }
  if (!Array.isArray(preparation.tokenIds) || preparation.tokenIds.length !== inputTokens) throw new KevWireError('Kev preparation token count does not match complete token ids')
  for (const token of preparation.tokenIds) {
    if (count(token) >= config.serviceCaps.vocabSize) throw new KevWireError('Kev preparation token id exceeds the reviewed vocabulary')
  }
  return { wire: { version: 1, deployment: config.deployment, request, preparation: preparation as JsonValue }, inputTokens }
}

/**
 * Validate normalized full-precision scores while retaining the unchanged official rounded result.
 * @param raw Complete decoded decision reply.
 * @param prepared Original recorded preparation.
 * @param config Frozen reviewed configuration.
 * @returns Provider response with honest optional usage and full raw envelope.
 */
export function parseDecision(raw: unknown, prepared: OperationPreparedJudgment, config: Config): OperationJudgmentResponse {
  const envelope = object(raw)
  exact(envelope, ['version', 'deployment', 'identity', 'requestDigest', 'probabilities', 'result'])
  envelopeIdentity(envelope, config)
  const wire = object(prepared.wire)
  if (typeof wire.request !== 'string' || envelope.requestDigest !== utf8Digest(wire.request)) throw new KevWireError('Kev decision request digest mismatch')
  const expected = prepared.draft.candidates.map(candidate => candidate.id)
  const probabilities = distribution(envelope.probabilities, expected)
  if (Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 1) > 1e-6) throw new KevWireError('Kev probabilities must sum to one')
  const result = object(envelope.result)
  exact(result, ['model', 'answers'], ['usage', 'latency_ms'])
  if (result.model !== config.wireModel) throw new KevWireError('Kev result model route mismatch')
  const answers = object(result.answers)
  exact(answers, ['transition'])
  const transition = object(answers.transition)
  exact(transition, ['type', 'choice', 'confidence', 'probabilities'])
  if (transition.type !== 'choice' || typeof transition.choice !== 'string' || !Object.hasOwn(probabilities, transition.choice)) throw new KevWireError('Kev result must choose a supplied candidate')
  const rounded = distribution(transition.probabilities, expected)
  for (const [id, fullPrecision] of Object.entries(probabilities)) {
    if (Math.abs(probability(rounded[id]) - fullPrecision) > 0.00005 + Number.EPSILON) {
      throw new KevWireError('Kev official scores disagree with full-precision probabilities')
    }
  }
  if (probabilities[transition.choice] !== Math.max(...Object.values(probabilities))
    || rounded[transition.choice] !== Math.max(...Object.values(rounded))) {
    throw new KevWireError('Kev choice must name a highest-probability candidate')
  }
  const providerConfidence = probability(transition.confidence)
  const usage = result.usage === undefined ? undefined : parseUsage(result.usage)
  if (result.latency_ms !== undefined && (typeof result.latency_ms !== 'number' || !Number.isFinite(result.latency_ms) || result.latency_ms < 0)) {
    throw new KevWireError('Kev latency must be finite and non-negative')
  }
  return {
    requestId: prepared.draft.id, identity: prepared.identity, probabilities, providerConfidence,
    ...(usage === undefined ? {} : { usage }),
    ...(result.latency_ms === undefined ? {} : { providerLatencyMs: result.latency_ms }), wire: envelope as JsonValue,
  }
}

function parseUsage(raw: unknown): NonNullable<OperationJudgmentResponse['usage']> {
  const usage = object(raw)
  exact(usage, ['input_tokens', 'output_tokens'], ['billing_units', 'total_tokens'])
  const inputTokens = count(usage.input_tokens)
  const outputTokens = count(usage.output_tokens)
  if (usage.total_tokens !== undefined && count(usage.total_tokens) !== inputTokens + outputTokens) throw new KevWireError('Kev total usage does not match reported token counts')
  return { inputTokens, outputTokens, ...(usage.billing_units === undefined ? {} : { billingUnits: count(usage.billing_units) }) }
}

function envelopeIdentity(envelope: Record<string, unknown>, config: Config): void {
  if (envelope.version !== 1 || envelope.deployment !== config.deployment) throw new KevWireError('Kev response deployment or version mismatch')
  const identity = object(envelope.identity)
  if (canonicalJson(identity as JsonValue) !== canonicalJson(serviceIdentity(config))) throw new KevWireError('Kev response manifest identity mismatch')
}

function distribution(raw: unknown, expected: readonly string[]): Record<string, number> {
  const value = object(raw)
  exact(value, expected)
  return Object.fromEntries(expected.map(id => [id, probability(value[id])]))
}

function probability(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new KevWireError('Kev probability must be finite within [0, 1]')
  return value
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new KevWireError('Kev count must be a non-negative safe integer')
  return value
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new KevWireError('Kev protocol value must be an object')
  return value as Record<string, unknown>
}

function exact(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (Object.keys(record).some(key => !required.includes(key) && !optional.includes(key))
    || required.some(key => !Object.hasOwn(record, key))) {
    throw new KevWireError('Kev protocol fields do not match the required complete envelope')
  }
}
