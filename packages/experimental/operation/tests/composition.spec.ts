import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool, ToolOutputError } from '@deepseek-ai/dsh-tools'
import * as timeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import OperationService from '../src/index.ts'
import type { OperationJudgmentProvider } from '../src/types.ts'
import type { OperationConfig } from '../src/runner.ts'
import { replayOperation } from '../src/replay.ts'

const roots: string[] = []
const contexts: Context[] = []
const identity = {
  provider: 'deterministic', model: 'fixture', encoder: 'fixture-encoding', tokenizer: 'fixture-tokenizer',
  serialization: 'fixture-v1', deployment: 'fixture-deployment', deploymentManifest: { reference: 'fixture-manifest', digest: 'sha256:fixture' }, calibrationId: 'fixture-calibration',
} as const

const provider: OperationJudgmentProvider = {
  identity,
  async prepare(draft) { return { draft, wire: { request: draft.id }, inputTokens: 1, identity } },
  async rank(prepared) {
    const first = prepared.draft.candidates.find(candidate => candidate.kind === 'continue' || candidate.kind === 'complete')
    if (first === undefined) throw new Error('fixture provider requires one autonomous candidate')
    const rest = prepared.draft.candidates.filter(candidate => candidate.id !== first.id)
    return {
      requestId: prepared.draft.id, identity,
      probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [
        candidate.id,
        candidate.id === first.id ? 0.9 : 0.1 / rest.length,
      ])),
      usage: { billingUnits: 1, inputTokens: 1, outputTokens: 0 },
    }
  },
}

afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function mounted(id: string, judgmentProvider: OperationJudgmentProvider = provider, config: OperationConfig = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-operation-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(OperationService, { maxWallMs: 10_000, ...config })
  ctx.effect(() => ctx.operations.registerJudgmentProvider(judgmentProvider), `operation-test.${id}.provider`)
  const agent = await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  return { ctx, agent }
}

function oneStepPlan(tool: string, argumentsExpression: unknown = { kind: 'literal', value: {} }) {
  return {
    version: 1, name: 'one-step', goal: 'verify fixture', inputs: {},
    steps: [{
      id: 'read', purpose: 'read fixture', tool, arguments: argumentsExpression,
      assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/ok' } }],
      observation: { paths: ['/ok'] }, question: 'Does the fixture support completion?',
    }],
    completion: {
      assertions: [{ kind: 'equals', left: { kind: 'result', step: 'read', pointer: '/ok' }, right: { kind: 'literal', value: true } }],
      evidence: [{ kind: 'result', step: 'read', pointer: '/ok' }], question: 'Complete?',
    },
  }
}

async function runOperation(ctx: Context, agent: Awaited<ReturnType<typeof mounted>>['agent'], plan: unknown, signal = new AbortController().signal) {
  return await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    callId: ToolCallId(`operation-${agent.session.id}`), name: 'run_operation', signal, agent,
    arguments: { plan },
  }))
}

const completePolicy = { allowOutputReferences: true, validateArguments() {}, inspectResult: () => ({ kind: 'complete' as const }) }

describe('operation opt-in composition', () => {
  it('dispatches planned nested tools through the real tool registry and persists replayable records', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    const root = mkdtempSync(join(tmpdir(), 'dsh-operation-'))
    roots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(OperationService, { maxWallMs: 10_000 })
    ctx.effect(() => ctx.operations.registerJudgmentProvider(provider), 'operation-test.provider')
    const observed: string[] = []
    const readFixture = defineTool({
      name: 'read_fixture', description: 'read fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { choices: { type: 'array', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute() { observed.push('read'); return { choices: [{ target: 'alpha' }] } },
    })
    const actFixture = defineTool({
      name: 'act_fixture', description: 'act fixture', parameters: { target: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args) { observed.push(args.target); return { ok: true } },
    })
    const completePolicy = { allowOutputReferences: true, validateArguments() {}, inspectResult: () => ({ kind: 'complete' as const }) }
    ctx.effect(() => ctx.operations.toolPolicies.register(readFixture, completePolicy), 'operation-test.readPolicy')
    ctx.effect(() => ctx.operations.toolPolicies.register(actFixture, completePolicy), 'operation-test.actPolicy')
    ctx.effect(() => ctx.tools.register(readFixture), 'operation-test.read')
    ctx.effect(() => ctx.tools.register(actFixture), 'operation-test.act')
    const agent = await ctx.agentLoop.create(SessionId('operation-agent'), { provider: 'mock', model: 'mock' })
    const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      callId: ToolCallId('operation-outer'), name: 'run_operation', signal: new AbortController().signal, agent,
      arguments: {
        plan: {
          version: 1, name: 'composition', goal: 'use alpha', inputs: {},
          steps: [
            { id: 'read', purpose: 'read', tool: 'read_fixture', arguments: { kind: 'literal', value: {} }, assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/choices' } }], observation: { paths: ['/choices'], candidates: '/choices' }, question: 'choose?' },
            { id: 'act', purpose: 'act', tool: 'act_fixture', arguments: { kind: 'object', properties: { target: { kind: 'selected', step: 'read', pointer: '/target' } } }, assertions: [{ kind: 'equals', left: { kind: 'result', step: 'act', pointer: '/ok' }, right: { kind: 'literal', value: true } }], observation: { paths: ['/ok'] }, question: 'continue?' },
          ],
          completion: { assertions: [{ kind: 'equals', left: { kind: 'result', step: 'act', pointer: '/ok' }, right: { kind: 'literal', value: true } }], evidence: [{ kind: 'result', step: 'act', pointer: '/ok' }], question: 'complete?' },
        },
      },
    }))
    expect(result.isError).toBe(false)
    expect(observed).toEqual(['read', 'alpha'])
    await ctx.sessions.flush(agent.session)
    expect(agent.session.snapshotEvents().filter(event => event.type.startsWith('operation/')).map(event => event.type)).toContain('operation/run-end')
    await ctx.fiber.dispose()
  })

  it('denies an otherwise visible tool when its exact definition has no trusted policy', async () => {
    const { ctx, agent } = await mounted('operation-policy-omitted')
    let executed = false
    const tool = defineTool({
      name: 'unverified_fixture', description: 'unverified fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { executed = true; return { ok: true } },
    })
    ctx.tools.register(tool)
    const result = await runOperation(ctx, agent, oneStepPlan(tool.name))
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected policy admission failure')
    expect(result.error.message).toContain('has no trusted operation policy')
    expect(executed).toBe(false)
    await ctx.fiber.dispose()
  })

  it('honors the calling agent scoped visibility before policy admission', async () => {
    const { ctx, agent } = await mounted('operation-policy-scoped')
    let executed = false
    const tool = defineTool({
      name: 'scoped_fixture', description: 'scoped fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { executed = true; return { ok: true } },
    })
    ctx.tools.register(tool)
    ctx.operations.toolPolicies.register(tool, completePolicy)
    agent.ctx.tools.restrict({ deny: [tool.name] })
    const result = await runOperation(ctx, agent, oneStepPlan(tool.name))
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected visibility denial')
    expect(result.error.message).toContain('unavailable or undiscovered')
    expect(executed).toBe(false)
    await ctx.fiber.dispose()
  })

  it('runs selected arguments through ordinary pre-execute policy before the second effect', async () => {
    const { ctx, agent } = await mounted('operation-policy-pre-execute')
    const effects: string[] = []
    const read = defineTool({
      name: 'policy_read_fixture', description: 'read fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { choices: { type: 'array', required: true } } }, render: () => [] },
      async execute() { effects.push('read'); return { choices: [{ target: 'alpha' }] } },
    })
    const act = defineTool({
      name: 'policy_act_fixture', description: 'act fixture', parameters: { target: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute(args) { effects.push(args.target); return { ok: true } },
    })
    ctx.tools.register(read)
    ctx.tools.register(act)
    ctx.operations.toolPolicies.register(read, completePolicy)
    ctx.operations.toolPolicies.register(act, completePolicy)
    let deniedArguments: unknown
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== act.name) return next()
      deniedArguments = exec.arguments
      return { kind: 'deny', reason: 'selected target denied by fixture policy' }
    })
    const result = await runOperation(ctx, agent, {
      version: 1, name: 'selected-policy', goal: 'use alpha', inputs: {},
      steps: [
        { id: 'read', purpose: 'read', tool: read.name, arguments: { kind: 'literal', value: {} }, assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/choices' } }], observation: { paths: ['/choices'], candidates: '/choices' }, question: 'choose?' },
        { id: 'act', purpose: 'act', tool: act.name, arguments: { kind: 'object', properties: { target: { kind: 'selected', step: 'read', pointer: '/target' } } }, assertions: [{ kind: 'present', value: { kind: 'result', step: 'act', pointer: '/ok' } }], observation: { paths: ['/ok'] }, question: 'continue?' },
      ],
      completion: { assertions: [{ kind: 'present', value: { kind: 'result', step: 'act', pointer: '/ok' } }], evidence: [{ kind: 'result', step: 'act', pointer: '/ok' }], question: 'complete?' },
    })
    expect(result).toMatchObject({ isError: true })
    expect(deniedArguments).toEqual({ target: 'alpha' })
    expect(effects).toEqual(['read'])
    await ctx.fiber.dispose()
  })

  it('inspects the canonical post-policy value rather than misleading rendered content', async () => {
    const { ctx, agent } = await mounted('operation-policy-canonical')
    const inspected: unknown[] = []
    const tool = defineTool({
      name: 'canonical_fixture', description: 'canonical fixture', parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
        render: () => [{ type: 'text', text: 'misleading renderer says failure' }],
      },
      async execute() { return { ok: false } },
    })
    ctx.tools.register(tool)
    ctx.operations.toolPolicies.register(tool, {
      allowOutputReferences: true,
      validateArguments() {},
      inspectResult(value) { inspected.push(value); return { kind: 'complete' } },
    })
    ctx.on('tools/post-execute', async (exec, _result, next) => exec.name === tool.name
      ? { kind: 'accept', value: { ok: true } }
      : next())
    const result = await runOperation(ctx, agent, oneStepPlan(tool.name))
    expect(result).toMatchObject({ isError: false, value: { status: 'completed' } })
    expect(inspected).toEqual([{ ok: true }])
    const stepResult = agent.session.snapshotEvents().find(event => event.type === 'operation/step-result')
    expect(stepResult?.data).toMatchObject({ value: { ok: true }, rendered: [{ text: 'misleading renderer says failure' }] })
    await ctx.fiber.dispose()
  })

  it('rejects a same-name same-schema definition replacement after admission', async () => {
    const { ctx, agent } = await mounted('operation-policy-replacement')
    const effects: string[] = []
    const original = defineTool({
      name: 'replaceable_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects.push('original'); return { ok: true } },
    })
    const replacement = defineTool({
      name: 'replaceable_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects.push('replacement'); return { ok: true } },
    })
    const unregisterOriginal = ctx.tools.register(original)
    ctx.operations.toolPolicies.register(replacement, completePolicy)
    let replaced = false
    ctx.operations.toolPolicies.register(original, {
      allowOutputReferences: true,
      validateArguments() {
        if (replaced) return
        replaced = true
        unregisterOriginal()
        ctx.tools.register(replacement)
      },
      inspectResult: completePolicy.inspectResult,
    })
    const result = await runOperation(ctx, agent, oneStepPlan(original.name))
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected definition replacement failure')
    expect(result.error.message).toContain('definition changed after admission')
    expect(effects).toEqual([])
    await ctx.fiber.dispose()
  })

  it('rejects an exact-definition replacement that occurs during asynchronous pre-policy', async () => {
    const { ctx, agent } = await mounted('operation-boundary-pre-replacement')
    const effects: string[] = []
    const original = defineTool({
      name: 'delayed_replaceable_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects.push('original'); return { ok: true } },
    })
    const replacement = defineTool({
      name: original.name, description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects.push('replacement'); return { ok: true } },
    })
    const unregisterOriginal = ctx.tools.register(original)
    ctx.operations.toolPolicies.register(original, completePolicy)
    ctx.operations.toolPolicies.register(replacement, completePolicy)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== original.name) return next()
      entered.resolve(undefined)
      await release.promise
      return next()
    })
    const running = runOperation(ctx, agent, oneStepPlan(original.name))
    await entered.promise
    unregisterOriginal()
    ctx.tools.register(replacement)
    release.resolve(undefined)
    const result = await running
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected body-boundary definition failure')
    expect(result.error.message).toContain('definition changed before dispatch')
    expect(effects).toEqual([])
    await ctx.fiber.dispose()
  })

  it('rejects policy withdrawal at the body boundary after an around-wrapper delay', async () => {
    const { ctx, agent } = await mounted('operation-boundary-policy-withdrawal')
    let effects = 0
    const tool = defineTool({
      name: 'withdrawn_policy_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects += 1; return { ok: true } },
    })
    ctx.tools.register(tool)
    const unregisterPolicy = ctx.operations.toolPolicies.register(tool, completePolicy)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name !== tool.name) return next()
      entered.resolve(undefined)
      await release.promise
      return next()
    })
    const running = runOperation(ctx, agent, oneStepPlan(tool.name))
    await entered.promise
    unregisterPolicy()
    release.resolve(undefined)
    const result = await running
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected body-boundary policy failure')
    expect(result.error.message).toContain('operation policy is unavailable at dispatch')
    expect(effects).toBe(0)
    await ctx.fiber.dispose()
  })

  it('permits at most one constrained body invocation when an around-wrapper calls next twice', async () => {
    const { ctx, agent } = await mounted('operation-boundary-single-invocation')
    let effects = 0
    const tool = defineTool({
      name: 'single_invocation_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects += 1; return { ok: true } },
    })
    ctx.tools.register(tool)
    ctx.operations.toolPolicies.register(tool, completePolicy)
    let secondMessage: string | undefined
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name !== tool.name) return next()
      const first = await next()
      const second = await next()
      if (second.isError) secondMessage = second.error.message
      return first
    })
    const result = await runOperation(ctx, agent, oneStepPlan(tool.name))
    expect(result).toMatchObject({ isError: false, value: { status: 'completed' } })
    expect(secondMessage).toContain('may be attempted only once')
    expect(effects).toBe(1)
    await ctx.fiber.dispose()
  })

  it('aborts and drains a cooperative active tool before service disposal settles', async () => {
    const lifecycleProvider = { ...provider, rank: vi.fn(provider.rank.bind(provider)) }
    const { ctx, agent } = await mounted('operation-service-disposal', lifecycleProvider)
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let effects = 0
    const tool = defineTool({
      name: 'disposing_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute(_args, exec) {
        effects += 1
        entered.resolve(undefined)
        if (exec.signal.aborted) aborted.resolve(undefined)
        else exec.signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
        await release.promise
        return { ok: true }
      },
    })
    ctx.tools.register(tool)
    ctx.operations.toolPolicies.register(tool, completePolicy)
    const running = runOperation(ctx, agent, oneStepPlan(tool.name))
    await entered.promise
    let disposed = false
    const disposing = ctx.fiber.dispose().then(() => { disposed = true })
    await aborted.promise
    await Promise.resolve(undefined)
    expect(disposed).toBe(false)
    release.resolve(undefined)
    await disposing
    const result = await running
    expect(result.isError).toBe(true)
    expect(effects).toBe(1)
    expect(lifecycleProvider.rank).not.toHaveBeenCalled()
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'operation/run-end')?.data).toMatchObject({ status: 'cancelled' })
  })

  it('drains late inference on service disposal without recording an accepted transition', async () => {
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const lifecycleProvider: OperationJudgmentProvider = {
      ...provider,
      async rank(prepared, signal) {
        signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
        entered.resolve(undefined)
        await release.promise
        return await provider.rank(prepared, signal)
      },
    }
    const { ctx, agent } = await mounted('operation-inference-disposal', lifecycleProvider)
    const tool = defineTool({
      name: 'before_inference_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { return { ok: true } },
    })
    ctx.effect(() => ctx.tools.register(tool), 'operation-test.beforeInferenceTool')
    ctx.effect(() => ctx.operations.toolPolicies.register(tool, completePolicy), 'operation-test.beforeInferencePolicy')
    const running = runOperation(ctx, agent, oneStepPlan(tool.name))
    let disposing: Promise<unknown> | undefined
    let disposed = false
    try {
      await entered.promise
      disposing = ctx.fiber.dispose().then(() => { disposed = true })
      await aborted.promise
      expect(disposed).toBe(false)
      release.resolve(undefined)
      await disposing
      expect(await running).toMatchObject({ isError: true })
      const replay = replayOperation(agent.session.snapshotEvents())
      expect(replay).toMatchObject({ status: 'cancelled', transitions: [], judgments: [{ result: { error: { code: 'CANCELLED' } } }] })
    } finally {
      release.resolve(undefined)
      await running
      await disposing
    }
  })

  it.each(['cancel', 'timeout'] as const)('retains started custom-error %s as unknown without later inference', async (interruption) => {
    const lifecycleProvider = { ...provider, rank: vi.fn(provider.rank.bind(provider)) }
    const { ctx, agent } = await mounted(`operation-custom-${interruption}`, lifecycleProvider, { maxToolDeadlineMs: 100 })
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const controller = new AbortController()
    let effects = 0
    const tool = defineTool({
      name: 'custom_failure_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute(_args, exec) {
        effects += 1
        exec.signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
        entered.resolve(undefined)
        await release.promise
        throw new ToolOutputError('custom_failure_fixture', ['fixture-owned settled failure after interruption'])
      },
    })
    ctx.effect(() => ctx.tools.register(tool), 'operation-test.customFailureTool')
    ctx.effect(() => ctx.operations.toolPolicies.register(tool, completePolicy), 'operation-test.customFailurePolicy')
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const running = runOperation(ctx, agent, oneStepPlan(tool.name), controller.signal)
    try {
      await entered.promise
      if (interruption === 'cancel') controller.abort()
      else await vi.advanceTimersByTimeAsync(100)
      await aborted.promise
      expect(agent.session.snapshotEvents().some(event => event.type === 'operation/run-end')).toBe(false)
      release.resolve(undefined)
      expect(await running).toMatchObject({ isError: true })
      expect(effects).toBe(1)
      expect(lifecycleProvider.rank).not.toHaveBeenCalled()
      const events = agent.session.snapshotEvents()
      const result = events.find(event => event.type === 'operation/step-result')
      expect(result?.data).toMatchObject({
        isError: true, error: { code: 'INVALID_TOOL_OUTPUT' },
        execution: { body: 'started', callerCancelled: interruption === 'cancel', timedOut: interruption === 'timeout' },
      })
      if (result?.type !== 'operation/step-result') throw new Error('missing settled tool result')
      expect(result.data.error?.message).toContain('fixture-owned settled failure')
      expect(replayOperation(events)).toMatchObject({
        status: interruption === 'cancel' ? 'cancelled' : 'failed',
        steps: [{ dispatch: 'started', outcome: 'unknown', result: { error: { code: 'INVALID_TOOL_OUTPUT' } } }],
      })
      expect(events.filter(event => event.type.startsWith('operation/')).map(event => event.type)).toEqual([
        'operation/run-start', 'operation/step-start', 'operation/step-result', 'operation/run-end',
      ])
    } finally {
      controller.abort()
      release.resolve(undefined)
      await running
      vi.useRealTimers()
    }
  })

  it('retains timeout-policy body interruption when tool-owned finalization reports a custom error', async () => {
    const lifecycleProvider = { ...provider, rank: vi.fn(provider.rank.bind(provider)) }
    const { ctx, agent } = await mounted('operation-wrapper-timeout', lifecycleProvider, { maxToolDeadlineMs: 1_000 })
    await ctx.plugin(timeoutPolicy)
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const ownedFailure = new ToolOutputError('wrapped_timeout_fixture', ['fixture-owned settled failure'])
    let policyCode: string | undefined
    let effects = 0
    const tool = defineTool({
      name: 'wrapped_timeout_fixture', description: 'fixture', parameters: {}, timeoutMs: 50,
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute(_args, exec) {
        effects += 1
        exec.signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
        entered.resolve(undefined)
        await release.promise
        throw ownedFailure
      },
      finalizeContent(_exec, result) {
        if (!result.isError) return undefined
        policyCode = result.error.info?.code
        throw ownedFailure
      },
    })
    ctx.effect(() => ctx.tools.register(tool), 'operation-test.wrappedTimeoutTool')
    ctx.effect(() => ctx.operations.toolPolicies.register(tool, completePolicy), 'operation-test.wrappedTimeoutPolicy')
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const running = runOperation(ctx, agent, oneStepPlan(tool.name))
    try {
      await entered.promise
      await vi.advanceTimersByTimeAsync(50)
      await aborted.promise
      expect(agent.session.snapshotEvents().some(event => event.type === 'operation/run-end')).toBe(false)
      release.resolve(undefined)
      expect(await running).toMatchObject({ isError: true })
      expect(effects).toBe(1)
      expect(policyCode).toBe('TOOL_TIMEOUT')
      expect(lifecycleProvider.rank).not.toHaveBeenCalled()
      expect(replayOperation(agent.session.snapshotEvents())).toMatchObject({
        status: 'failed', judgments: [],
        steps: [{ dispatch: 'started', outcome: 'unknown', result: {
          error: { code: 'INVALID_TOOL_OUTPUT', message: ownedFailure.message },
          execution: { body: 'started', callerCancelled: false, timedOut: false, bodySignalAborted: true },
        } }],
      })
    } finally {
      release.resolve(undefined)
      await running
      vi.useRealTimers()
    }
  })

  it.each(['before-body', 'masked-success'] as const)('records effective wrapper cancellation at %s without further inference', async (phase) => {
    const lifecycleProvider = { ...provider, rank: vi.fn(provider.rank.bind(provider)) }
    const { ctx, agent } = await mounted(`operation-wrapper-${phase}`, lifecycleProvider)
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const controller = new AbortController()
    let effects = 0
    const tool = defineTool({
      name: 'wrapped_abort_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute(_args, exec) {
        effects += 1
        exec.signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
        entered.resolve(undefined)
        await release.promise
        return { ok: true }
      },
    })
    ctx.effect(() => ctx.tools.register(tool), 'operation-test.wrappedAbortTool')
    ctx.effect(() => ctx.operations.toolPolicies.register(tool, completePolicy), 'operation-test.wrappedAbortPolicy')
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name !== tool.name) return next()
      const original = exec.signal
      exec.signal = controller.signal
      if (phase === 'before-body') controller.abort()
      try {
        const result = await next()
        return phase === 'masked-success' ? { isError: false as const, value: { ok: true }, content: [] } : result
      } finally {
        exec.signal = original
      }
    })
    const running = runOperation(ctx, agent, oneStepPlan(tool.name))
    try {
      if (phase === 'masked-success') {
        await entered.promise
        controller.abort()
        await aborted.promise
        expect(agent.session.snapshotEvents().some(event => event.type === 'operation/run-end')).toBe(false)
        release.resolve(undefined)
      }
      expect(await running).toMatchObject({ isError: true })
      expect(effects).toBe(phase === 'before-body' ? 0 : 1)
      expect(lifecycleProvider.rank).not.toHaveBeenCalled()
      expect(replayOperation(agent.session.snapshotEvents())).toMatchObject({
        status: 'failed', judgments: [], steps: [{
          dispatch: phase === 'before-body' ? 'not-started' : 'started',
          outcome: phase === 'before-body' ? 'failed' : 'unknown',
          result: { execution: { callerCancelled: false, timedOut: false, bodySignalAborted: phase === 'masked-success' } },
        }],
      })
    } finally {
      controller.abort()
      release.resolve(undefined)
      await running
    }
  })

  it.each(['cancel', 'deny'] as const)('records %s before the body as known not-started', async (action) => {
    const lifecycleProvider = { ...provider, rank: vi.fn(provider.rank.bind(provider)) }
    const { ctx, agent } = await mounted(`operation-predispatch-${action}`, lifecycleProvider)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const controller = new AbortController()
    let effects = 0
    const tool = defineTool({
      name: 'never_started_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects += 1; return { ok: true } },
    })
    ctx.effect(() => ctx.tools.register(tool), 'operation-test.neverStartedTool')
    ctx.effect(() => ctx.operations.toolPolicies.register(tool, completePolicy), 'operation-test.neverStartedPolicy')
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== tool.name) return next()
      entered.resolve(undefined)
      await release.promise
      return action === 'deny' ? { kind: 'deny', reason: 'fixture denial' } : next()
    })
    const running = runOperation(ctx, agent, oneStepPlan(tool.name), controller.signal)
    try {
      await entered.promise
      if (action === 'cancel') controller.abort()
      release.resolve(undefined)
      expect(await running).toMatchObject({ isError: true })
      expect(effects).toBe(0)
      expect(lifecycleProvider.rank).not.toHaveBeenCalled()
      expect(replayOperation(agent.session.snapshotEvents())).toMatchObject({
        status: action === 'cancel' ? 'cancelled' : 'failed',
        steps: [{ outcome: 'failed', dispatch: 'not-started', result: { execution: { callerCancelled: action === 'cancel', timedOut: false } } }],
      })
    } finally {
      controller.abort()
      release.resolve(undefined)
      await running
    }
  })

  it.each(['pre-policy', 'final-validator'] as const)('rejects an elapsed deadline at %s even before the timer callback runs', async (phase) => {
    const lifecycleProvider = { ...provider, rank: vi.fn(provider.rank.bind(provider)) }
    const { ctx, agent } = await mounted(`operation-boundary-clock-${phase}`, lifecycleProvider, { maxToolDeadlineMs: 100 })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let boundary = false
    let effects = 0
    const tool = defineTool({
      name: 'expired_boundary_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects += 1; return { ok: true } },
    })
    ctx.effect(() => ctx.tools.register(tool), 'operation-test.expiredBoundaryTool')
    ctx.effect(() => ctx.operations.toolPolicies.register(tool, {
      ...completePolicy,
      validateArguments() { if (phase === 'final-validator' && boundary) vi.setSystemTime(Date.now() + 101) },
    }), 'operation-test.expiredBoundaryPolicy')
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name !== tool.name) return next()
      entered.resolve(undefined)
      await release.promise
      boundary = true
      return next()
    })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const running = runOperation(ctx, agent, oneStepPlan(tool.name))
    try {
      await entered.promise
      if (phase === 'pre-policy') vi.setSystemTime(Date.now() + 101)
      release.resolve(undefined)
      expect(await running).toMatchObject({ isError: true })
      expect(effects).toBe(0)
      expect(lifecycleProvider.rank).not.toHaveBeenCalled()
      expect(replayOperation(agent.session.snapshotEvents())).toMatchObject({
        status: 'failed', steps: [{ dispatch: 'not-started', outcome: 'failed', result: { execution: { timedOut: true } } }],
      })
    } finally {
      release.resolve(undefined)
      await running
      vi.useRealTimers()
    }
  })

  it('forwards a nested concludeTurn marker and stops the operation', async () => {
    const { ctx, agent } = await mounted('operation-concludes-turn')
    const tool = defineTool({
      name: 'concluding_fixture', description: 'fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute(_args, exec) { exec.concludeTurn(); return { ok: true } },
    })
    ctx.tools.register(tool)
    ctx.operations.toolPolicies.register(tool, completePolicy)
    const result = await runOperation(ctx, agent, oneStepPlan(tool.name))
    expect(result).toMatchObject({ isError: false, concludesTurn: true, value: { status: 'stopped' } })
    await ctx.fiber.dispose()
  })

  it('validates every statically resolvable later step before the first effect', async () => {
    const { ctx, agent } = await mounted('operation-policy-static')
    const effects: string[] = []
    const first = defineTool({
      name: 'static_first_fixture', description: 'first', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects.push('first'); return { ok: true } },
    })
    const second = defineTool({
      name: 'static_second_fixture', description: 'second', parameters: { target: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      async execute() { effects.push('second'); return { ok: true } },
    })
    ctx.tools.register(first)
    ctx.tools.register(second)
    ctx.operations.toolPolicies.register(first, completePolicy)
    ctx.operations.toolPolicies.register(second, completePolicy)
    const result = await runOperation(ctx, agent, {
      version: 1, name: 'static-preflight', goal: 'reject invalid later literal', inputs: {},
      steps: [
        { id: 'first', purpose: 'first', tool: first.name, arguments: { kind: 'literal', value: {} }, assertions: [{ kind: 'present', value: { kind: 'result', step: 'first', pointer: '/ok' } }], observation: { paths: ['/ok'] }, question: 'continue?' },
        { id: 'second', purpose: 'second', tool: second.name, arguments: { kind: 'literal', value: { target: 42 } }, assertions: [{ kind: 'present', value: { kind: 'result', step: 'second', pointer: '/ok' } }], observation: { paths: ['/ok'] }, question: 'continue?' },
      ],
      completion: { assertions: [{ kind: 'present', value: { kind: 'result', step: 'second', pointer: '/ok' } }], evidence: [{ kind: 'result', step: 'second', pointer: '/ok' }], question: 'complete?' },
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected argument schema failure')
    expect(result.error.message).toContain('must be a string')
    expect(effects).toEqual([])
    await ctx.fiber.dispose()
  })
})
