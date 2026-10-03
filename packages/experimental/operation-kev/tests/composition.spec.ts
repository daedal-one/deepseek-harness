import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import OperationService, { replayOperation } from '@deepseek-ai/dsh-experimental-operation'
import * as operationFs from '@deepseek-ai/dsh-experimental-operation-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as operationKev from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { decision, fixtureConfig, json, preparation, requestBody, secret, startServer } from './harness.ts'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  } finally {
    vi.restoreAllMocks()
  }
})

async function load(root: string, config: Config) {
  const configPath = join(root, 'cordis.yml')
  const rows = [
    { name: '@deepseek-ai/dsh-llm' },
    { name: '@deepseek-ai/dsh-session' },
    { name: '@deepseek-ai/dsh-session-projection' },
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    { name: '@deepseek-ai/dsh-agent' },
    { name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), dshHome: root, watch: false } },
    { name: '@deepseek-ai/dsh-fs-local', config: { cwd: root } },
    { name: '@deepseek-ai/dsh-subprocess-local' },
    { name: '@deepseek-ai/dsh-experimental-operation', config: { requireCalibration: true } },
    {
      name: '@deepseek-ai/dsh-experimental-operation-fs',
      config: {
        approvedRoots: [root], maxPathBytes: 4096, maxPatternBytes: 256,
        readMaxLines: 20, readMaxLineLength: 200, readMaxBytes: 4096, readStreamMinSize: 4096,
        globMaxResults: 20, sampleOverCapGlobResults: false,
        grepMaxMatches: 20, grepMaxLineBytes: 200, searchMetaMaxBytes: 2048,
        rawOutputMaxBytes: 32768, graceMs: 100, stderrMaxBytes: 1024, timeoutMs: 5000,
      },
    },
    { name: '@deepseek-ai/dsh-experimental-operation-kev', config },
  ]
  // JSON is a YAML subset, parsed through the ordinary Include file entry.
  await writeFile(configPath, JSON.stringify(rows))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  expect('default' in operationKev).toBe(false)
  expect(ctx.loader.unwrapExports(operationKev)).toMatchObject({
    name: operationKev.name, inject: operationKev.inject, apply: operationKev.apply, Config: operationKev.Config,
  })
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime], ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence], ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials], ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime], ['@deepseek-ai/dsh-experimental-operation', OperationService],
    ['@deepseek-ai/dsh-experimental-operation-fs', operationFs], ['@deepseek-ai/dsh-experimental-operation-kev', operationKev],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  await ctx.credentials.set(credentialRef(config.credentialRef), secret)
  const agent = await ctx.agentLoop.create(SessionId('synthetic-kev-composition'), {}, { cwd: root })
  return { ctx, agent }
}

describe('real Loader Kev operation composition', () => {
  it('persists the prepared official request before decision, retains both score representations, and unregisters on unload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-kev-composition-'))
    cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
    const fixtureText = 'Synthetic-only evidence: "quoted", é, 🚀, \\path\n'
    const fixturePath = join(root, 'synthetic.txt')
    await writeFile(fixturePath, fixtureText)
    const requests: Array<{
      path: string | undefined
      authorization: string | undefined
      body: Record<string, unknown>
      flushed: boolean
    }> = []
    let judgmentFlushed = false
    const server = await startServer(async (request, response) => {
      if (request.url === '/barrier-probe') {
        json(response, { reachable: true })
        return
      }
      const body = await requestBody(request)
      requests.push({ path: request.url, authorization: request.headers.authorization, body, flushed: judgmentFlushed })
      if (typeof body.request !== 'string') throw new Error('synthetic service requires official request text')
      if (request.url === '/v1/prepare') json(response, preparation(config, body.request))
      else if (request.url === '/v1/decision') json(response, decision(config, body.request))
      else { response.statusCode = 404; response.end() }
    })
    cleanups.push(async () => { await server.dispose() })
    // These identities and calibration apply only to this synthetic HTTP fixture, never model qualification.
    const config = fixtureConfig(server.endpoint, {
      calibrationId: 'synthetic-only-not-qualification',
      credentialRef: `SYNTHETIC_KEV_${randomUUID().replaceAll('-', '_')}`,
    })
    const { ctx, agent } = await load(root, config)
    const schemas = (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(tool => tool.name)
    expect(schemas).toEqual(expect.arrayContaining(['run_operation', 'read']))
    expect(ctx.operations.judgments.requireProvider().identity).toMatchObject({
      provider: config.providerId, deployment: config.deployment, calibrationId: 'synthetic-only-not-qualification',
    })

    const expectedLines = [{ number: 1, text: fixtureText.trimEnd() }]
    const assertion = {
      kind: 'equals', left: { kind: 'result', step: 'read', pointer: '/lines' }, right: { kind: 'literal', value: expectedLines },
    }
    const plan = {
      version: 1, name: 'synthetic-read-only', goal: 'Read the complete synthetic fixture without modifying it.', inputs: {},
      steps: [{
        id: 'read', tool: 'read', purpose: 'Inspect synthetic evidence',
        arguments: { kind: 'literal', value: { file_path: 'synthetic.txt', limit: 20 } },
        assertions: [assertion], observation: { paths: ['/lines'] }, question: 'Is the read complete?',
      }],
      completion: {
        assertions: [assertion], evidence: [{ kind: 'result', step: 'read', pointer: '/lines' }],
        question: 'Does the complete read establish the synthetic goal?\nPreserve "é 🚀".',
      },
    }
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    const flush = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (session === agent.session && session.snapshotEvents().at(-1)?.type === 'operation/judgment-request') {
        entered.resolve(undefined)
        await release.promise
        const persisted = await originalFlush(session)
        judgmentFlushed = persisted
        return persisted
      }
      return originalFlush(session)
    })
    const controller = new AbortController()
    const run = ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      name: 'run_operation', arguments: { plan }, agent, callId: ToolCallId('synthetic-operation-call'), signal: controller.signal,
    }))
    cleanups.push(async () => { controller.abort(); release.resolve(undefined); await run; flush.mockRestore() })
    await Promise.race([
      entered.promise,
      run.then((result) => { throw new Error(`operation settled before judgment persistence barrier: ${JSON.stringify(result)}`) }),
    ])
    expect(requests.map(request => request.path)).toEqual(['/v1/prepare'])
    expect(judgmentFlushed).toBe(false)
    // A completed local HTTP round trip gives any incorrectly unblocked decision request a chance to arrive.
    const probe = await fetch(`${server.endpoint}/barrier-probe`)
    expect(await probe.json()).toEqual({ reachable: true })
    expect(requests.map(request => request.path)).toEqual(['/v1/prepare'])

    const checkpoint = agent.session.snapshotEvents().find(event => event.type === 'operation/judgment-request')
    if (checkpoint?.type !== 'operation/judgment-request') throw new Error('missing judgment request record')
    const officialRequest = JSON.stringify({
      model: config.wireModel,
      state: {
        goal: plan.goal, step: 'read', purpose: plan.steps[0]!.purpose,
        observations: [{ step: 'read', pointer: '/lines', value: expectedLines }], completionEvidence: [expectedLines],
      },
      questions: { transition: {
        type: 'choice', instructions: plan.completion.question,
        criteria: {
          complete: 'Complete the operation because all declared verification checks passed and the evidence supports the goal.',
          'needs-replan': 'Return control to the planner because declared checks do not establish semantic completion.',
          stop: 'Stop because the observed evidence contradicts completion.',
        },
      } },
    })
    const preparedWire = {
      version: 1, deployment: config.deployment, request: officialRequest,
      preparation: preparation(config, officialRequest).preparation,
    }
    expect(requests[0]!.body).toEqual({ version: 1, deployment: config.deployment, request: officialRequest })
    expect(checkpoint.data.request.wire).toEqual(preparedWire)
    expect(checkpoint.data.request.inputTokens).toBe(3)
    expect(preparedWire.preparation.tokenIds).toEqual([12, 23, 34])

    // A rotated file-backed credential must be resolved again for the decision request.
    const rotatedSecret = `${secret}-rotated`
    await ctx.credentials.set(credentialRef(config.credentialRef), rotatedSecret)
    release.resolve(undefined)
    expect(await run).toMatchObject({
      isError: false,
      value: { status: 'completed', attemptedSteps: ['read'], completedSteps: ['read'], verification: [{ index: 0, passed: true }] },
    })
    expect(requests.map(request => request.path)).toEqual(['/v1/prepare', '/v1/decision'])
    expect(requests.map(request => request.authorization)).toEqual([`Bearer ${secret}`, `Bearer ${rotatedSecret}`])
    expect(requests[1]!.flushed).toBe(true)
    expect(requests[1]!.body).toEqual(preparedWire)

    const handle = await ctx.sessionPersistence.open(agent.session.id, 'read')
    try {
      const { events } = await handle.read()
      expect(events).toEqual(agent.session.snapshotEvents())
      expect(events.filter(event => event.type.startsWith('operation/')).map(event => event.type)).toEqual([
        'operation/run-start', 'operation/step-start', 'operation/step-result', 'operation/judgment-request',
        'operation/judgment-result', 'operation/transition', 'operation/run-end',
      ])
      const storedRequest = events.find(event => event.type === 'operation/judgment-request')
      expect(storedRequest).toEqual(checkpoint)
      const result = events.find(event => event.type === 'operation/judgment-result')
      expect(result?.data).toMatchObject({ response: {
        probabilities: { complete: 0.888888, 'needs-replan': 0.055556, stop: 0.055556 },
        providerConfidence: 0.8889, usage: { inputTokens: 3, outputTokens: 17 },
        wire: decision(config, officialRequest),
      } })
      expect(result?.data).toMatchObject({ response: { wire: { result: { answers: { transition: {
        type: 'choice', choice: 'complete', confidence: 0.8889,
        probabilities: { complete: 0.8889, 'needs-replan': 0.0556, stop: 0.0556 },
      } } } } } })
      expect(replayOperation(events)).toMatchObject({
        status: 'completed', steps: [{ stepId: 'read', tool: 'read', outcome: 'succeeded', dispatch: 'started' }],
        terminal: { completedSteps: ['read'] },
      })
      expect(JSON.stringify(events)).not.toContain(secret)
    } finally {
      await handle.close()
    }
    expect(await readFile(fixturePath, 'utf8')).toBe(fixtureText)

    const providerEntry = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-operation-kev')
    if (providerEntry?.fiber === undefined) throw new Error('Kev provider Loader entry was not mounted')
    await providerEntry.fiber.dispose()
    expect(() => ctx.operations.judgments.requireProvider()).toThrow('operation judgment provider is not configured')
    expect(ctx.tools.get('run_operation')).toBeDefined()
  })
})
