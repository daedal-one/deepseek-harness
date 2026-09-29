import { describe, expect, it } from 'vitest'
import { OperationCandidateId, OperationJudgmentRequestId, OperationRunId } from '@deepseek-ai/dsh-experimental-operation'
import type { OperationJudgmentDraft, OperationPreparedJudgment, OperationTokenizer } from '@deepseek-ai/dsh-experimental-operation'
import { ClmHttpProvider } from '../src/provider.ts'
import { clmStateText } from '../src/wire.ts'

const identity = {
  provider: 'clm-http', model: 'fixture-model', encoder: 'fixture-encoder', tokenizer: 'fixture-tokenizer',
  serialization: 'clm-systemone-bb42c6c5', deployment: 'fixture-deployment',
  deploymentManifest: { reference: 'fixture-manifest', digest: 'sha256:fixture' },
  calibrationId: 'fixture-calibration',
} as const

const config = {
  endpoint: 'http://127.0.0.1/v1/systemone', tokenizerId: identity.tokenizer, model: identity.model, encoder: identity.encoder,
  deployment: identity.deployment, deploymentManifest: identity.deploymentManifest, calibrationId: identity.calibrationId,
  providerId: identity.provider, serialization: identity.serialization, temperature: 0.75, timeoutMs: 1_000, maxResponseBytes: 2_048,
} as const

function draft(): OperationJudgmentDraft {
  return {
    id: OperationJudgmentRequestId('request-1'), runId: OperationRunId('run-1'), kind: 'continuation',
    state: { observation: 'exact' }, question: 'select one',
    candidates: [
      { id: OperationCandidateId('continue-0'), kind: 'continue', nextStep: 'next', arguments: { target: 'alpha' }, description: 'continue alpha' },
      { id: OperationCandidateId('needs-replan'), kind: 'needs-replan', description: 'replan' },
    ],
  }
}

function tokenizer(onCount: (text: string) => number = text => text.length): OperationTokenizer {
  return { id: identity.tokenizer, async count(text) { return onCount(text) } }
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    model: identity.model,
    answers: {
      transition: {
        type: 'choice', choice: 'continue-0', confidence: 0.8,
        probabilities: { 'continue-0': 0.9, 'needs-replan': 0.1 },
      },
    },
    usage: { billing_units: 1, input_tokens: 3, output_tokens: 2 },
    ...overrides,
  }
}

async function prepared(provider: ClmHttpProvider): Promise<OperationPreparedJudgment> {
  return await provider.prepare(draft(), new AbortController().signal)
}

function pendingRequest() {
  let enter: (() => void) | undefined
  const entered = new Promise<void>((resolve) => { enter = resolve })
  return {
    entered,
    request: async (_input: string, init: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      const abort = (): void => { reject(new Error('request aborted')) }
      if (init.signal?.aborted) abort()
      else init.signal?.addEventListener('abort', abort, { once: true })
      enter?.()
    }),
  }
}

describe('CLM System One operation provider', () => {
  it('renders upstream state text rather than JSON markup', () => {
    expect(clmStateText({ nested: { enabled: true }, records: [null, 'alpha'], empty: null }, 'choose')).toBe(
      'nested:\n  enabled: true\n\nrecords:\n  - \n  - alpha\n\nempty:\n\nchoose',
    )
  })

  it('sends the pinned System One body and counts the actual encoder texts', async () => {
    const counted: string[] = []
    let request: { input: string; method: string | undefined; body: string } | undefined
    const provider = new ClmHttpProvider(config, tokenizer((text) => { counted.push(text); return text.length }), async (input, init) => {
      if (typeof init.body !== 'string') throw new Error('CLM request body must be text')
      request = { input, method: init.method, body: init.body }
      return new Response(JSON.stringify(response()), { headers: { 'content-type': 'application/json' } })
    })

    const requestPrepared = await prepared(provider)
    expect(counted).toEqual(['observation: exact\n\nselect one', 'continue alpha', 'replan'])
    expect(requestPrepared.inputTokens).toBe(counted.reduce((total, text) => total + text.length, 0))
    const ranked = await provider.rank(requestPrepared, new AbortController().signal)

    expect(request?.input).toBe(config.endpoint)
    expect(request?.method).toBe('POST')
    expect(JSON.parse(request?.body ?? '')).toEqual({
      state: { observation: 'exact' },
      model: identity.model,
      temperature: config.temperature,
      questions: {
        transition: {
          type: 'choice',
          instructions: 'select one',
          criteria: { 'continue-0': 'continue alpha', 'needs-replan': 'replan' },
        },
      },
    })
    expect(request?.body).not.toContain('requestId')
    expect(request?.body).not.toContain('deployment')
    expect(request?.body).not.toContain('encoder')
    expect(request?.body).not.toContain('truncation')
    expect(ranked).toMatchObject({ requestId: draft().id, identity, probabilities: { 'continue-0': 0.9, 'needs-replan': 0.1 } })
    expect(ranked.usage).toEqual({ billingUnits: 1, inputTokens: 3, outputTokens: 2 })
  })

  it('rejects model mismatch, unknown choices, malformed answers, and incomplete distributions', async () => {
    const cases = [
      response({ model: 'other-model' }),
      response({ answers: { transition: { type: 'choice', choice: 'unknown', confidence: 0.8, probabilities: { 'continue-0': 0.9, 'needs-replan': 0.1 } } } }),
      response({ answers: { transition: { type: 'choice', choice: 'continue-0', confidence: 0.8, probabilities: { 'continue-0': 1 } } } }),
      response({ answers: { transition: { type: 'choice', choice: 'continue-0', confidence: 0.8, probabilities: { 'continue-0': 0.4, 'needs-replan': 0.4 } } } }),
      { model: identity.model, answers: {}, usage: { billing_units: 1, input_tokens: 0, output_tokens: 0 } },
    ]
    for (const body of cases) {
      const provider = new ClmHttpProvider(config, tokenizer(), async () => new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }))
      await expect(provider.rank(await prepared(provider), new AbortController().signal)).rejects.toMatchObject({ code: 'CLM_WIRE' })
    }
  })

  it('does not equate cache-dependent upstream input usage with local token accounting', async () => {
    const provider = new ClmHttpProvider(config, tokenizer(() => 10), async () => new Response(JSON.stringify(response({
      usage: { billing_units: 1, input_tokens: 0, output_tokens: 2 },
    })), { headers: { 'content-type': 'application/json' } }))
    const requestPrepared = await prepared(provider)
    expect(requestPrepared.inputTokens).toBe(30)
    await expect(provider.rank(requestPrepared, new AbortController().signal)).resolves.toMatchObject({
      usage: { billingUnits: 1, inputTokens: 0, outputTokens: 2 },
    })
  })

  it('rejects non-complete transports through body bounds, partial statuses, and full JSON parsing', async () => {
    const tooLarge = new ClmHttpProvider({ ...config, maxResponseBytes: 10 }, tokenizer(), async () => new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': '11' },
    }))
    await expect(tooLarge.rank(await prepared(tooLarge), new AbortController().signal)).rejects.toMatchObject({ code: 'CLM_BODY_LIMIT' })

    const partial = new ClmHttpProvider(config, tokenizer(), async () => new Response(JSON.stringify(response()), {
      status: 206, headers: { 'content-type': 'application/json' },
    }))
    await expect(partial.rank(await prepared(partial), new AbortController().signal)).rejects.toMatchObject({ code: 'CLM_HTTP_STATUS' })

    const incomplete = new ClmHttpProvider(config, tokenizer(), async () => new Response('{', {
      headers: { 'content-type': 'application/json' },
    }))
    await expect(incomplete.rank(await prepared(incomplete), new AbortController().signal)).rejects.toMatchObject({ code: 'CLM_WIRE' })
  })

  it('propagates timeout after the request owns transport work', async () => {
    const pending = pendingRequest()
    const timeout = new ClmHttpProvider({ ...config, timeoutMs: 10 }, tokenizer(), pending.request)
    const ranking = timeout.rank(await prepared(timeout), new AbortController().signal)
    await pending.entered
    await expect(ranking).rejects.toMatchObject({ code: 'CLM_TIMEOUT' })
  })

  it('propagates caller abort after the request owns transport work', async () => {
    const pending = pendingRequest()
    const provider = new ClmHttpProvider(config, tokenizer(), pending.request)
    const controller = new AbortController()
    const ranking = provider.rank(await prepared(provider), controller.signal)
    await pending.entered
    controller.abort(new Error('caller cancelled'))
    await expect(ranking).rejects.toMatchObject({ code: 'CLM_CANCELLED' })
  })

  it('aborts and drains provider-owned work on disposal', async () => {
    const pending = pendingRequest()
    const provider = new ClmHttpProvider(config, tokenizer(), pending.request)
    const requestPrepared = await prepared(provider)
    const ranking = provider.rank(requestPrepared, new AbortController().signal)
    await pending.entered
    await provider.dispose()
    await expect(ranking).rejects.toMatchObject({ code: 'CLM_DISPOSED' })
    await expect(provider.rank(requestPrepared, new AbortController().signal)).rejects.toMatchObject({ code: 'CLM_DISPOSED' })
  })

  it('resolves a credential for each request without placing it in the wire record', async () => {
    let resolves = 0
    const authorizations: string[] = []
    const provider = new ClmHttpProvider({ ...config, credentialRef: 'CLM_API_KEY' }, tokenizer(), async (_input, init) => {
      authorizations.push(new Headers(init.headers).get('authorization') ?? '')
      return new Response(JSON.stringify(response()), { headers: { 'content-type': 'application/json' } })
    }, async () => `secret-${++resolves}`)
    const first = await prepared(provider)
    await provider.rank(first, new AbortController().signal)
    await provider.rank(first, new AbortController().signal)
    expect(authorizations).toEqual(['Bearer secret-1', 'Bearer secret-2'])
    expect(JSON.stringify(first)).not.toContain('secret-')
  })
})
