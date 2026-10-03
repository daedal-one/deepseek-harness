import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { OperationCandidateId, OperationJudgmentRequestId, OperationRunId, type OperationJudgmentDraft } from '@deepseek-ai/dsh-experimental-operation'
import { utf8Digest } from '@deepseek-ai/dsh-experimental-operation-clm/local-http'
import type { Config } from '../src/config.ts'
import { serviceIdentity } from '../src/wire.ts'

export const secret = 'synthetic-private-credential'

export function fixtureConfig(endpoint: string, overrides: Partial<Config> = {}): Config {
  return {
    endpoint, credentialRef: 'SYNTHETIC_KEV_KEY', providerId: 'synthetic-local-kev', model: 'synthetic-artifact-sha256', wireModel: 'synthetic-kev-route',
    encoder: 'synthetic-official-encoder', tokenizerId: 'synthetic-tokenizer', serialization: 'kev-90512f1c-systemone-choice-v1',
    deployment: `sha256:${'a'.repeat(64)}`, deploymentManifest: { reference: 'synthetic-test-only-manifest', digest: `sha256:${'a'.repeat(64)}` },
    dtype: 'float32', timeoutMs: 1_000, maxRequestBytes: 65_536, maxResponseBytes: 65_536, maxConcurrentRequests: 2,
    serviceCaps: {
      maxInputTokens: 4096, vocabSize: 1024, maxCandidates: 16, maxRequestBytes: 65_536, maxResponseBytes: 65_536,
      maxQueueSize: 2, requestTimeoutMs: 1_000, executionTimeoutMs: 500,
    },
    ...overrides,
  }
}

export function draft(): OperationJudgmentDraft {
  return {
    id: OperationJudgmentRequestId('synthetic-request'), runId: OperationRunId('synthetic-run'), kind: 'completion',
    state: { z: ['quotes"', 'nul\u0000', '🚀', 'line\n', '\ufeff'], a: { tiny: 1e-9, no: false, empty: null } }, question: 'Complete?\nPreserve é',
    candidates: [
      { id: OperationCandidateId('complete'), kind: 'complete', description: 'Full completion description\n🚀' },
      { id: OperationCandidateId('needs-replan'), kind: 'needs-replan', description: 'Replan the entire request' },
      { id: OperationCandidateId('stop'), kind: 'stop', description: 'Stop' },
    ],
  }
}

export function preparation(config: Config, request: string) {
  return {
    version: 1, deployment: config.deployment, identity: serviceIdentity(config),
    preparation: {
      requestDigest: utf8Digest(request), tokenizer: config.tokenizerId, serialization: config.serialization,
      inputTokens: 3, maxInputTokens: config.serviceCaps.maxInputTokens, tokenIds: [12, 23, 34],
    },
  }
}

export function decision(config: Config, request: string) {
  return {
    version: 1, deployment: config.deployment, identity: serviceIdentity(config), requestDigest: utf8Digest(request),
    probabilities: { complete: 0.888888, 'needs-replan': 0.055556, stop: 0.055556 },
    result: {
      model: config.wireModel,
      latency_ms: 1.2,
      answers: { transition: { type: 'choice', choice: 'complete', confidence: 0.8889, probabilities: { complete: 0.8889, 'needs-replan': 0.0556, stop: 0.0556 } } },
      usage: { input_tokens: 3, output_tokens: 17 },
    },
  }
}

export async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void) {
  const server = createServer((request, response) => {
    void Promise.resolve().then(() => handler(request, response)).catch(() => { response.destroy() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture requires TCP address')
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    async dispose() {
      const closing = new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve() })
      })
      server.closeAllConnections()
      await closing
    },
  }
}

export async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const value: unknown = chunk
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    if (!(bytes instanceof Uint8Array)) throw new Error('fixture request contains an unsupported chunk')
    chunks.push(Buffer.from(bytes))
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('fixture request requires a JSON object')
  return body as Record<string, unknown>
}

export function json(response: ServerResponse, value: unknown): void {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}
