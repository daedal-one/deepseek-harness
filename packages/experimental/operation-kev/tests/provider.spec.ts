import { afterEach, describe, expect, it } from 'vitest'
import type { OperationPreparedJudgment } from '@deepseek-ai/dsh-experimental-operation'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { Config, resolveConfig } from '../src/config.ts'
import { KevHttpProvider } from '../src/provider.ts'
import { decision, draft, fixtureConfig, json, preparation, requestBody, secret, startServer } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(
  mutate?: (value: ReturnType<typeof preparation> | ReturnType<typeof decision>, route: string) => unknown,
  overrides: Partial<Config> = {},
) {
  const requests: { route: string; body: Record<string, unknown>; authorization: string | undefined }[] = []
  const server = await startServer(async (req, res) => {
    const body = await requestBody(req)
    if (req.url === undefined || typeof body.request !== 'string') throw new Error('fixture requires a route and request text')
    requests.push({ route: req.url, body, authorization: req.headers.authorization })
    const value = req.url === '/v1/prepare' ? preparation(config, body.request) : decision(config, body.request)
    json(res, mutate?.(value, req.url) ?? value)
  })
  cleanups.push(() => server.dispose())
  const config = fixtureConfig(server.endpoint, overrides)
  const provider = new KevHttpProvider(config, async () => secret)
  cleanups.push(() => provider.dispose())
  return { provider, config, requests }
}
const signal = () => new AbortController().signal

// Malformed fixtures mutate only existing object paths; leaf fields may be added or removed.
function mutable(value: unknown, ...path: readonly (string | number)[]): Record<string, unknown> {
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error('fixture mutation path does not exist')
    }
    value = (value as Record<string, unknown>)[key]
  }
  if (value === null || typeof value !== 'object') throw new Error('fixture mutation requires an object')
  return value as Record<string, unknown>
}

function increment(value: Record<string, unknown>, key: string): void {
  const current = value[key]
  if (typeof current !== 'number') throw new Error('fixture increment requires a number')
  value[key] = current + 1
}

function changedWire(wire: JsonValue, path: readonly string[], fields: Record<string, JsonValue>): JsonValue {
  const copy = structuredClone(wire)
  Object.assign(mutable(copy, ...path), fields)
  return copy
}

describe('private local Kev provider over real HTTP', () => {
  it('prepares exact official JSON once and ranks the complete recorded envelope with honest usage', async () => {
    const { provider, config, requests } = await fixture()
    const source = draft()
    const prepared = await provider.prepare(source, signal())
    expect(requests.map(item => item.route)).toEqual(['/v1/prepare'])
    const body = requests[0]!.body
    expect(body).toEqual({ version: 1, deployment: config.deployment, request: JSON.stringify({
      model: config.wireModel, state: source.state, questions: { transition: { type: 'choice', instructions: source.question, criteria: Object.fromEntries(source.candidates.map(item => [item.id, item.description])) } },
    }) })
    expect(prepared).toMatchObject({ inputTokens: 3, wire: { preparation: { tokenIds: [12, 23, 34] } } })
    expect(prepared.identity.model).not.toBe(config.wireModel)
    expect(Object.isFrozen(prepared.draft.candidates)).toBe(true)
    expect(Object.isFrozen(prepared.wire)).toBe(true)
    const ranked = await provider.rank(structuredClone(prepared), signal())
    expect(requests[1]!.body).toEqual(prepared.wire)
    expect(requests.every(item => item.authorization === `Bearer ${secret}`)).toBe(true)
    expect(ranked.usage).toEqual({ inputTokens: 3, outputTokens: 17 })
    expect(ranked.providerLatencyMs).toBe(1.2)
    expect(ranked.probabilities).toEqual({ complete: 0.888888, 'needs-replan': 0.055556, stop: 0.055556 })
    expect(ranked.wire).toEqual(decision(config, body.request as string))
    expect(JSON.stringify(prepared)).not.toContain(secret)
  })

  it('pins configuration, manifests, candidate descriptions, and state before asynchronous HTTP', async () => {
    const { config } = await fixture()
    const provider = new KevHttpProvider(config, async () => secret)
    cleanups.push(() => provider.dispose())
    const digest = provider.identity.configurationDigest
    const source = draft()
    const pending = provider.prepare(source, signal())
    mutable(source.state).z = 'changed state'
    mutable(source.candidates[0]).description = 'changed action'
    mutable(config).wireModel = 'changed route'
    mutable(config.serviceCaps).maxInputTokens = 1
    mutable(config.deploymentManifest).reference = 'changed manifest'
    // Remote fixture uses its own original identity for the frozen provider.
    mutable(config).wireModel = 'synthetic-kev-route'
    mutable(config.serviceCaps).maxInputTokens = 4096
    mutable(config.deploymentManifest).reference = 'synthetic-test-only-manifest'
    const result = await pending
    expect(result.draft).toEqual(draft())
    expect(result.identity.configurationDigest).toBe(digest)
    expect(result.identity.deploymentManifest?.reference).toBe('synthetic-test-only-manifest')
    expect(new KevHttpProvider(fixtureConfig(config.endpoint), async () => 'rotated').identity).toEqual(provider.identity)
    const invalidDtype = Object.assign({}, config, { dtype: 'bfloat16' }) as unknown as Config
    expect(() => new KevHttpProvider(invalidDtype)).toThrow()
    const changes: Partial<Config>[] = [
      { wireModel: 'different' }, { timeoutMs: 2000 }, { model: 'different-artifact' },
      { deployment: `sha256:${'b'.repeat(64)}`, deploymentManifest: { reference: 'other', digest: `sha256:${'b'.repeat(64)}` } },
    ]
    for (const change of changes) {
      expect(new KevHttpProvider(Object.assign({}, config, change)).identity.configurationDigest).not.toBe(digest)
    }
  })

  it.each([
    ['version', (value: unknown) => { mutable(value).version = 2 }],
    ['deployment', (value: unknown) => { mutable(value).deployment = 'drift' }],
    ['identity', (value: unknown) => { mutable(value, 'identity').encoder = 'drift' }],
    ['manifest cap', (value: unknown) => { increment(mutable(value, 'identity', 'serviceCaps'), 'maxQueueSize') }],
    ['digest', (value: unknown) => { mutable(value, 'preparation').requestDigest = 'sha256:wrong' }],
    ['tokenizer', (value: unknown) => { mutable(value, 'preparation').tokenizer = 'drift' }],
    ['serialization', (value: unknown) => { mutable(value, 'preparation').serialization = 'drift' }],
    ['ceiling', (value: unknown) => { increment(mutable(value, 'preparation'), 'maxInputTokens') }],
    ['count', (value: unknown) => { mutable(value, 'preparation').inputTokens = 2 }],
    ['fraction', (value: unknown) => { mutable(value, 'preparation', 'tokenIds')[0] = 1.5 }],
    ['unsafe', (value: unknown) => { mutable(value, 'preparation', 'tokenIds')[0] = Number.MAX_SAFE_INTEGER + 1 }],
    ['vocabulary', (value: unknown) => { mutable(value, 'preparation', 'tokenIds')[0] = 1024 }],
    ['negative', (value: unknown) => { mutable(value, 'preparation', 'tokenIds')[0] = -1 }],
    ['extra', (value: unknown) => { mutable(value, 'preparation').truncated = true }],
  ])('rejects preparation %s drift before any inference', async (_name, mutate) => {
    const { provider, requests } = await fixture((value) => { mutate(value); return value })
    await expect(provider.prepare(draft(), signal())).rejects.toMatchObject({ code: 'KEV_WIRE' })
    expect(requests.map(item => item.route)).toEqual(['/v1/prepare'])
  })

  it.each([
    ['missing', (value: unknown) => { delete mutable(value, 'probabilities').stop }],
    ['extra', (value: unknown) => { mutable(value, 'probabilities').unknown = 0 }],
    ['unnormalized', (value: unknown) => { mutable(value, 'probabilities').complete = 0.5 }],
    ['rounded drift', (value: unknown) => { mutable(value, 'result', 'answers', 'transition', 'probabilities').complete = 0.8 }],
    ['choice', (value: unknown) => { mutable(value, 'result', 'answers', 'transition').choice = 'stop' }],
    ['confidence', (value: unknown) => { mutable(value, 'result', 'answers', 'transition').confidence = -1 }],
    ['usage', (value: unknown) => { mutable(value, 'result', 'usage').output_tokens = 1.5 }],
    ['billing', (value: unknown) => { mutable(value, 'result', 'usage').billing_units = -1 }],
    ['negative latency', (value: unknown) => { mutable(value, 'result').latency_ms = -1 }],
    ['digest', (value: unknown) => { mutable(value).requestDigest = 'different' }],
    ['alias', (value: unknown) => { mutable(value, 'result').model = 'different' }],
    ['deployment', (value: unknown) => { mutable(value, 'identity').dtype = 'bfloat16' }],
    ['tool authority', (value: unknown) => { mutable(value, 'result', 'answers', 'transition').tool = { name: 'bash' } }],
  ])('rejects result %s without interpreting it as authority', async (_name, mutate) => {
    const { provider } = await fixture((value, route) => { if (route === '/v1/decision') mutate(value); return value })
    await expect(provider.rank(await provider.prepare(draft(), signal()), signal())).rejects.toMatchObject({ code: 'KEV_WIRE' })
  })

  it('rejects JSON numeric overflow in reported latency', async () => {
    const server = await startServer(async (req, res) => {
      const body = await requestBody(req)
      if (typeof body.request !== 'string') throw new Error('fixture requires request text')
      if (req.url === '/v1/prepare') json(res, preparation(config, body.request))
      else {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(decision(config, body.request)).replace('"latency_ms":1.2', '"latency_ms":1e999'))
      }
    })
    cleanups.push(() => server.dispose())
    const config = fixtureConfig(server.endpoint)
    const provider = new KevHttpProvider(config, async () => secret)
    cleanups.push(() => provider.dispose())
    await expect(provider.rank(await provider.prepare(draft(), signal()), signal())).rejects.toMatchObject({ code: 'KEV_WIRE' })
  })

  it('does not fabricate absent provider accounting', async () => {
    const { provider } = await fixture((value, route) => {
      if (route === '/v1/decision') delete mutable(value, 'result').usage
      return value
    })
    const result = await provider.rank(await provider.prepare(draft(), signal()), signal())
    expect(result).not.toHaveProperty('usage')
  })

  it('retains reported billing when supplied without applying CLM billing rules', async () => {
    const { provider } = await fixture((value, route) => {
      if (route === '/v1/decision') mutable(value, 'result', 'usage').billing_units = 7
      return value
    })
    const result = await provider.rank(await provider.prepare(draft(), signal()), signal())
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 17, billingUnits: 7 })
  })

  it('rejects forged prepared draft/request/count/identity before transport', async () => {
    const { provider, requests } = await fixture()
    const prepared = await provider.prepare(draft(), signal())
    const forged: OperationPreparedJudgment[] = [
      { ...prepared, identity: { ...prepared.identity, model: 'changed' } },
      { ...prepared, draft: { ...prepared.draft, question: 'changed' } },
      { ...prepared, draft: { ...prepared.draft, candidates: [...prepared.draft.candidates].reverse() } },
      { ...prepared, inputTokens: prepared.inputTokens + 1 },
      { ...prepared, wire: changedWire(prepared.wire, [], { request: '{}' }) },
      { ...prepared, wire: changedWire(prepared.wire, [], { extra: true }) },
      { ...prepared, wire: changedWire(prepared.wire, ['preparation'], { tokenIds: [1, 2] }) },
    ]
    for (const input of forged) await expect(provider.rank(input, signal())).rejects.toMatchObject({ code: 'KEV_WIRE' })
    expect(requests).toHaveLength(1)
  })

  it('rejects unknown configuration fields without exposing their values', () => {
    const config = fixtureConfig('http://localhost')
    const invalidConfigs: unknown[] = [
      Object.assign({}, config, { injected: secret }),
      Object.assign({}, config, { deploymentManifest: Object.assign({}, config.deploymentManifest, { injected: secret }) }),
      Object.assign({}, config, { serviceCaps: Object.assign({}, config.serviceCaps, { injected: secret }) }),
    ]
    for (const invalid of invalidConfigs) {
      expect(() => resolveConfig(invalid as Config)).toThrow()
      try { resolveConfig(invalid as Config) } catch (error: unknown) {
        expect(String(error)).not.toContain(secret)
      }
    }
  })

  it('requires explicit loopback origin, artifact manifest, supported dtype/recipe, credential, and caps', () => {
    for (const change of [
      { endpoint: 'https://127.0.0.1' }, { endpoint: 'http://example.com' }, { endpoint: 'http://user:secret@localhost' },
      { endpoint: 'http://localhost/v1/decision' }, { endpoint: 'http://localhost/?token=secret' },
      { deploymentManifest: { reference: 'manifest', digest: 'not-a-digest' } }, { deploymentManifest: { reference: '', digest: `sha256:${'a'.repeat(64)}` } },
      { deployment: `sha256:${'b'.repeat(64)}` },
      { serialization: 'chat-template' }, { dtype: 'bfloat16' }, { credentialRef: '' },
      { timeoutMs: 0 }, { timeoutMs: 2_147_483_648 }, { maxConcurrentRequests: Infinity },
    ]) {
      const invalid = Object.assign({}, fixtureConfig('http://localhost'), change) as unknown as Config
      expect(() => resolveConfig(invalid)).toThrow()
    }
    expect(Config['~standard'].validate({})).toHaveProperty('issues')
    expect(resolveConfig(fixtureConfig('http://[::1]:3210')).endpoint).toBe('http://[::1]:3210')
    const noCalibration = resolveConfig(fixtureConfig('http://127.0.0.1'))
    expect(noCalibration.calibrationId).toBeUndefined()
  })
})
