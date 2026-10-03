/** Synthetic external Kev protocol fixture; this never loads or qualifies a model. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { canonicalJson } from '@deepseek-ai/dsh-experimental-operation'
import { KevHttpProvider, type Config } from '@deepseek-ai/dsh-experimental-operation-kev'
import { registerFixtureReaders, selectedFixtureRecord } from './profile.ts'

export const name = 'operation-kev-sdk-fixture'
export const inject = ['tools', 'operations']

const endpoint = 'http://127.0.0.1:9'
const secret = 'synthetic-fixture-only'
const digest = (text: string): string => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
const deployment = digest('synthetic-kev-protocol-fixture-v1')
const config: Config = {
  endpoint,
  credentialRef: 'DSH_KEV_FIXTURE_KEY',
  providerId: 'synthetic-kev-protocol',
  model: 'fixture-not-a-qualified-model',
  wireModel: 'fixture-kev',
  encoder: 'fixture-not-a-model-encoder',
  tokenizerId: 'fixture-utf8-bytes',
  serialization: 'kev-90512f1c-systemone-choice-v1',
  deployment,
  deploymentManifest: { reference: 'synthetic-protocol-fixture-only', digest: deployment },
  dtype: 'float32',
  serviceCaps: {
    maxInputTokens: 16384,
    vocabSize: 256,
    maxCandidates: 16,
    maxRequestBytes: 131072,
    maxResponseBytes: 131072,
    maxQueueSize: 0,
    requestTimeoutMs: 5000,
    executionTimeoutMs: 5000,
  },
  calibrationId: 'fixture-not-model-calibration',
  timeoutMs: 5000,
  maxRequestBytes: 131072,
  maxResponseBytes: 131072,
  maxConcurrentRequests: 1,
}
const identity = {
  model: config.model, wireModel: config.wireModel, encoder: config.encoder,
  tokenizer: config.tokenizerId, serialization: config.serialization,
  dtype: config.dtype, serviceCaps: config.serviceCaps,
}

/**
 * Mount the real provider against a process-local synthetic external HTTP response source.
 * The fixed endpoint keeps configuration identity stable without reserving a shared port.
 * @param ctx Isolated SDK fixture context with the opt-in operation service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const previous = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== endpoint) return await previous(input, init)
      if (init?.signal?.aborted) throw init.signal.reason
      if (init?.method !== 'POST' || new Headers(init.headers).get('authorization') !== `Bearer ${secret}`) {
        throw new Error('synthetic Kev fixture requires an authorized POST')
      }
      if (typeof init.body !== 'string') throw new Error('synthetic Kev fixture requires a complete JSON body')
      const body = JSON.parse(init.body) as Record<string, unknown>
      if (body.version !== 1 || body.deployment !== deployment || typeof body.request !== 'string') {
        throw new Error('synthetic Kev fixture request identity changed')
      }
      // This declared byte tokenizer is a transport oracle, not official Kev encoding.
      const tokenIds = Array.from(Buffer.from(body.request, 'utf8'))
      const preparation = {
        requestDigest: digest(body.request), tokenizer: config.tokenizerId,
        serialization: config.serialization, inputTokens: tokenIds.length,
        maxInputTokens: config.serviceCaps.maxInputTokens, tokenIds,
      }
      if (url.pathname === '/v1/prepare') {
        if ('preparation' in body) throw new Error('preparation must precede the recorded decision envelope')
        return json({ version: 1, deployment, identity, preparation })
      }
      if (url.pathname !== '/v1/decision' || !isDeepStrictEqual(body.preparation, preparation)) {
        throw new Error('synthetic Kev fixture decision must retain exact preparation')
      }
      const request = JSON.parse(body.request) as {
        model: string
        questions: { transition: { criteria: Record<string, string> } }
      }
      if (request.model !== config.wireModel) throw new Error('synthetic Kev fixture model route changed')
      const criteria = request.questions.transition.criteria
      const winner = Object.hasOwn(criteria, 'complete') ? 'complete'
        : Object.keys(criteria).find(id => criteria[id]!.includes(canonicalJson(selectedFixtureRecord)))
      if (winner === undefined) throw new Error('synthetic Kev fixture requires the complete beta record or completion')
      const probabilities = Object.fromEntries(Object.keys(criteria).map(id => [id, id === winner ? 1 : 0]))
      const answers = { transition: { type: 'choice', choice: winner, confidence: 1, probabilities } }
      return json({
        version: 1, deployment, identity, requestDigest: preparation.requestDigest, probabilities,
        result: {
          model: config.wireModel, answers,
          usage: { input_tokens: tokenIds.length, output_tokens: Buffer.byteLength(JSON.stringify(answers), 'utf8') },
        },
      })
    }
    return () => { globalThis.fetch = previous }
  }, 'operation-kev-fixture.externalTransport')
  registerFixtureReaders(ctx)
  ctx.effect(() => {
    const provider = new KevHttpProvider(config, async () => secret)
    const unregister = ctx.operations.registerJudgmentProvider(provider)
    return async () => { unregister(); await provider.dispose() }
  }, 'operation-kev-fixture.provider')
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}
