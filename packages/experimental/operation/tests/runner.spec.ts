import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { OperationJudgmentRegistry } from '../src/judgment.ts'
import { OperationToolPolicyRegistry } from '../src/policy.ts'
import type { OperationToolPolicy } from '../src/policy.ts'
import { replayOperation } from '../src/replay.ts'
import { OperationRunner } from '../src/runner.ts'
import type { OperationConfig } from '../src/runner.ts'
import type { OperationJudgmentProvider, OperationPreparedJudgment } from '../src/types.ts'

const identity = {
  provider: 'deterministic', model: 'fixture', encoder: 'fixture-encoding', tokenizer: 'fixture-tokenizer',
  serialization: 'fixture-v1', deployment: 'fixture-deployment', deploymentManifest: { reference: 'fixture-manifest', digest: 'sha256:fixture' }, calibrationId: 'fixture-calibration',
} as const

const definition = {
  name: 'fixture_tool',
  description: 'fixture',
  parameters: { type: 'object', additionalProperties: true },
  output: { schema: {} },
} as unknown as ToolDefinition

function plan(): JsonValue {
  return {
    version: 1,
    name: 'fixture-plan',
    goal: 'select alpha',
    inputs: {},
    steps: [
      {
        id: 'read', purpose: 'read fixture records', tool: 'fixture_tool', arguments: { kind: 'literal', value: { mode: 'read' } },
        assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/choices' } }],
        observation: { paths: ['/choices'], candidates: '/choices' }, question: 'Which record should continue?',
      },
      {
        id: 'act', purpose: 'use one record', tool: 'fixture_tool',
        arguments: { kind: 'object', properties: { target: { kind: 'selected', step: 'read', pointer: '/target' } } },
        assertions: [{ kind: 'equals', left: { kind: 'result', step: 'act', pointer: '/ok' }, right: { kind: 'literal', value: true } }],
        observation: { paths: ['/ok'] }, question: 'Does this action preserve the goal?',
      },
    ],
    completion: {
      assertions: [{ kind: 'equals', left: { kind: 'result', step: 'act', pointer: '/ok' }, right: { kind: 'literal', value: true } }],
      evidence: [{ kind: 'result', step: 'act', pointer: '/ok' }], question: 'Do checks support completion?',
    },
  }
}

function success(value: JsonValue) {
  return { isError: false as const, content: [{ type: 'text' as const, text: JSON.stringify(value) }], value }
}

function failure(message: string) {
  return { isError: true as const, error: { message }, content: [{ type: 'text' as const, text: `Error: ${message}` }] }
}

function setup(options: {
  flush?: () => boolean
  provider?: OperationJudgmentProvider
  signal?: AbortSignal
  config?: OperationConfig
  policy?: OperationToolPolicy
  execute?: (input: { arguments: JsonValue; signal: AbortSignal }) => Promise<unknown>
} = {}) {
  const records: Array<{ type: string; data: unknown }> = []
  const flushes: string[][] = []
  const calls: JsonValue[] = []
  const session = { append: (type: string, data: unknown) => { records.push({ type, data }) } }
  const tools = {
    admitted: () => definition,
    execute: async (input: { arguments: JsonValue; signal: AbortSignal }) => {
      calls.push(input.arguments)
      if (options.execute !== undefined) return await options.execute(input)
      return calls.length === 1 ? success({ choices: [{ target: 'alpha' }, { target: 'beta' }] }) : success({ ok: true })
    },
  }
  const ctx = {
    tools,
    sessions: {
      flush: async () => {
        flushes.push(records.map(record => record.type))
        return options.flush?.() ?? true
      },
    },
  } as unknown as Context
  const provider = options.provider ?? deterministicProvider()
  const judgments = { requireProvider: () => provider } as unknown as OperationJudgmentRegistry
  const toolPolicies = new OperationToolPolicyRegistry()
  toolPolicies.register(definition, options.policy ?? {
    allowOutputReferences: true,
    validateArguments() {},
    inspectResult: () => ({ kind: 'complete' }),
  })
  const runner = new OperationRunner(ctx, judgments, toolPolicies, { maxWallMs: 10_000, ...options.config })
  const exec = {
    agent: { session },
    callId: ToolCallId('outer'), rootCallId: ToolCallId('outer'), token: Symbol('outer'), signal: options.signal ?? new AbortController().signal,
    concludeTurn: () => {}, deferContext: () => {},
  } as unknown as ToolRunContext
  return { runner, records, flushes, calls, exec }
}

function deterministicProvider(): OperationJudgmentProvider {
  return {
    identity,
    async prepare(draft) {
      return { draft, wire: { request: draft.id }, inputTokens: 1, identity }
    },
    async rank(prepared) {
      const probabilities = Object.fromEntries(prepared.draft.candidates.map(candidate => [candidate.id, candidate.kind === 'continue' || candidate.kind === 'complete' ? 0.9 : 0.05]))
      const leading = prepared.draft.candidates.find(candidate => candidate.kind === 'continue' || candidate.kind === 'complete')
      if (leading === undefined) throw new Error('fixture provider requires one autonomous candidate')
      const remainder = prepared.draft.candidates.filter(candidate => candidate.id !== leading.id)
      for (const candidate of remainder) probabilities[candidate.id] = 0.1 / remainder.length
      return { requestId: prepared.draft.id, identity, probabilities, usage: { billingUnits: 1, inputTokens: 1, outputTokens: 0 } }
    },
  }
}

describe('sequential operation runner', () => {
  it('flushes judgment input and selected transition with next intent before following dispatch', async () => {
    const fixture = setup()
    const result = await fixture.runner.run(fixture.exec, plan())
    expect(result.status).toBe('completed')
    expect(fixture.calls).toEqual([{ mode: 'read' }, { target: 'alpha' }])
    expect(fixture.records.map(record => record.type)).toEqual([
      'operation/run-start', 'operation/step-start', 'operation/step-result', 'operation/judgment-request',
      'operation/judgment-result', 'operation/transition', 'operation/step-start', 'operation/step-result',
      'operation/judgment-request', 'operation/judgment-result', 'operation/transition', 'operation/run-end',
    ])
    const events = fixture.records.map((record, seq) => ({ ...record, seq, time: seq })) as never
    const replay = replayOperation(events)
    expect(replay.status).toBe('completed')
    expect(replay.steps).toMatchObject([{ stepId: 'read', outcome: 'succeeded' }, { stepId: 'act', outcome: 'succeeded' }])
    expect(replay.judgments).toHaveLength(2)
    expect(fixture.flushes[5]?.slice(-3)).toEqual(['operation/judgment-result', 'operation/transition', 'operation/step-start'])

    const interrupted = replayOperation(fixture.records.slice(0, 2).map((record, seq) => ({ ...record, seq, time: seq })) as never)
    expect(interrupted).toMatchObject({ status: 'interrupted', steps: [{ stepId: 'read', outcome: 'unknown' }] })
  })

  it('unconditionally rejects nested run_operation dispatch before effects', async () => {
    const candidate = plan() as { steps: Array<{ tool: string }> }
    candidate.steps[0]!.tool = 'run_operation'
    const fixture = setup()
    await expect(fixture.runner.run(fixture.exec, candidate)).rejects.toMatchObject({ code: 'TOOL_EXCLUDED' })
    expect(fixture.calls).toEqual([])
  })

  it('rejects plans whose mandatory checkpoints or controls cannot fit before effects', async () => {
    for (const config of [{ maxJudgments: 1 }, { maxCandidates: 2 }]) {
      const fixture = setup({ config })
      await expect(fixture.runner.run(fixture.exec, plan())).rejects.toThrow()
      expect(fixture.calls).toEqual([])
    }
  })

  it('includes runner control choices in the frozen candidate ceiling', async () => {
    const fixture = setup({ config: { maxCandidates: 3 } })
    await expect(fixture.runner.run(fixture.exec, plan())).resolves.toMatchObject({
      status: 'needs-replan', reason: 'step "read" candidate collection exceeds 1 records',
    })
    expect(fixture.calls).toEqual([{ mode: 'read' }])
    expect(fixture.records.some(record => record.type === 'operation/judgment-request')).toBe(false)
  })

  it('requires local deployment-manifest verification before autonomous execution', async () => {
    const { deploymentManifest: _manifest, ...unverifiedIdentity } = identity
    const provider: OperationJudgmentProvider = { ...deterministicProvider(), identity: unverifiedIdentity }
    const fixture = setup({ provider, config: { requireCalibration: false } })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'PROVIDER_IDENTITY' })
    expect(fixture.calls).toEqual([])
  })

  it('does not dispatch any tool when the initial durability barrier fails', async () => {
    const fixture = setup({ flush: () => false })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toThrow('requires a composed session persistence flush barrier')
    expect(fixture.calls).toEqual([])
    expect(fixture.records.map(record => record.type)).toEqual(['operation/run-start', 'operation/run-end'])
  })

  it.each([3, 4, 5, 6])('stops at failed recording barrier %i before later work', async (failedBarrier) => {
    let barriers = 0
    let inferences = 0
    const provider = deterministicProvider()
    const originalRank = provider.rank.bind(provider)
    provider.rank = async (prepared, signal) => {
      inferences += 1
      return await originalRank(prepared, signal)
    }
    const fixture = setup({ provider, flush: () => ++barriers !== failedBarrier })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toThrow('flush barrier')
    expect(inferences).toBe(failedBarrier <= 4 ? 0 : 1)
    expect(fixture.calls).toEqual([{ mode: 'read' }])
  })

  it('observes cancellation during the selected-transition barrier before next dispatch', async () => {
    const controller = new AbortController()
    let barriers = 0
    const fixture = setup({
      signal: controller.signal,
      flush: () => { if (++barriers === 6) controller.abort(); return true },
    })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fixture.calls).toEqual([{ mode: 'read' }])
  })

  it('returns control instead of dispatching a low-confidence continuation', async () => {
    const provider = deterministicProvider()
    provider.rank = async prepared => ({
      requestId: prepared.draft.id,
      identity,
      probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [candidate.id, 1 / prepared.draft.candidates.length])),
      usage: { billingUnits: 1, inputTokens: 1, outputTokens: 0 },
    })
    const fixture = setup({ provider })
    const result = await fixture.runner.run(fixture.exec, plan())
    expect(result.status).toBe('needs-replan')
    expect(fixture.calls).toEqual([{ mode: 'read' }])
  })

  it('does not spend judgments after a tool failure or mandatory assertion failure', async () => {
    const toolFailureProvider = deterministicProvider()
    const failedRank = vi.fn(
      async (prepared: OperationPreparedJudgment, signal: AbortSignal) => await deterministicProvider().rank(prepared, signal),
    )
    toolFailureProvider.rank = failedRank
    const toolFailure = setup({
      provider: toolFailureProvider,
      execute: async () => ({ isError: true, error: { message: 'fixture denied' }, content: [] }),
    })
    await expect(toolFailure.runner.run(toolFailure.exec, plan())).rejects.toMatchObject({ code: 'TOOL_FAILED' })
    expect(failedRank).not.toHaveBeenCalled()
    expect(toolFailure.calls).toHaveLength(1)
    expect(toolFailure.records.map(record => record.type)).toEqual([
      'operation/run-start', 'operation/step-start', 'operation/step-result', 'operation/run-end',
    ])

    const assertionFailureProvider = deterministicProvider()
    const assertionRank = vi.fn(
      async (prepared: OperationPreparedJudgment, signal: AbortSignal) => await deterministicProvider().rank(prepared, signal),
    )
    assertionFailureProvider.rank = assertionRank
    const assertionFailure = setup({
      provider: assertionFailureProvider,
      execute: async () => success({}),
    })
    const result = await assertionFailure.runner.run(assertionFailure.exec, plan())
    expect(result.status).toBe('stopped')
    expect(assertionRank).not.toHaveBeenCalled()
    expect(assertionFailure.calls).toHaveLength(1)
  })

  it('rejects unknown provider candidates before a further dispatch', async () => {
    const provider = deterministicProvider()
    provider.rank = async prepared => ({
      requestId: prepared.draft.id,
      identity,
      probabilities: { unknown: 1 },
      usage: { billingUnits: 1, inputTokens: 0, outputTokens: 0 },
    })
    const fixture = setup({ provider })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'JUDGMENT_RESPONSE' })
    expect(fixture.calls).toEqual([{ mode: 'read' }])
    expect(fixture.records.at(-1)?.type).toBe('operation/run-end')
  })

  it('drains a cancelled judgment before recording cancellation and prevents the next dispatch', async () => {
    const controller = new AbortController()
    const provider = deterministicProvider()
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    provider.rank = async (_prepared, signal) => await new Promise<never>((_resolve, reject) => {
      started?.()
      signal.addEventListener('abort', () => { reject(new Error('fixture provider was cancelled')) }, { once: true })
    })
    const fixture = setup({ provider, signal: controller.signal })
    const running = fixture.runner.run(fixture.exec, plan())
    await entered
    controller.abort(new Error('cancelled by test'))
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fixture.calls).toEqual([{ mode: 'read' }])
    expect(fixture.records.find(record => record.type === 'operation/judgment-result')?.data).toMatchObject({
      error: { code: 'CANCELLED' },
    })
    expect(fixture.records.at(-1)?.type).toBe('operation/run-end')
  })

  it('records a settled cancelled tool outcome before terminal cancellation', async () => {
    const controller = new AbortController()
    const provider = deterministicProvider()
    const rank = vi.fn(
      async (prepared: OperationPreparedJudgment, signal: AbortSignal) => await deterministicProvider().rank(prepared, signal),
    )
    provider.rank = rank
    let entered: (() => void) | undefined
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const fixture = setup({
      provider,
      signal: controller.signal,
      execute: async input => await new Promise((resolve) => {
        entered?.()
        input.signal.addEventListener('abort', () => { resolve(failure('fixture tool was cancelled')) }, { once: true })
      }),
    })
    const running = fixture.runner.run(fixture.exec, plan())
    await ready
    controller.abort(new Error('cancelled by test'))
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fixture.records.map(record => record.type)).toEqual([
      'operation/run-start', 'operation/step-start', 'operation/step-result', 'operation/run-end',
    ])
    expect(fixture.records[2]?.data).toMatchObject({ isError: true, error: { message: 'fixture tool was cancelled' } })
    expect(rank).not.toHaveBeenCalled()
    expect(fixture.calls).toHaveLength(1)
  })

  it('records a settled tool outcome before failing an operation-owned tool deadline', async () => {
    const provider = deterministicProvider()
    const rank = vi.fn(
      async (prepared: OperationPreparedJudgment, signal: AbortSignal) => await deterministicProvider().rank(prepared, signal),
    )
    provider.rank = rank
    const fixture = setup({
      provider,
      config: { maxToolDeadlineMs: 20 },
      execute: async input => await new Promise((resolve) => {
        input.signal.addEventListener('abort', () => { resolve(success({ choices: [{ target: 'alpha' }] })) }, { once: true })
      }),
    })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' })
    expect(fixture.records.map(record => record.type)).toEqual([
      'operation/run-start', 'operation/step-start', 'operation/step-result', 'operation/run-end',
    ])
    expect(fixture.records[2]?.data).toMatchObject({ isError: false, value: { choices: [{ target: 'alpha' }] } })
    expect(rank).not.toHaveBeenCalled()
    expect(fixture.calls).toHaveLength(1)
  })

  it('records a judgment deadline failure without retrying or dispatching again', async () => {
    const provider = deterministicProvider()
    const rank = vi.fn(async (_prepared: OperationPreparedJudgment, signal: AbortSignal) => await new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('fixture judgment timed out')) }, { once: true })
    }))
    provider.rank = rank
    const fixture = setup({ provider, config: { maxJudgmentDeadlineMs: 20 } })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'JUDGMENT_TIMEOUT' })
    expect(fixture.records.map(record => record.type)).toEqual([
      'operation/run-start', 'operation/step-start', 'operation/step-result', 'operation/judgment-request',
      'operation/judgment-result', 'operation/run-end',
    ])
    expect(fixture.records.find(record => record.type === 'operation/judgment-result')?.data).toMatchObject({
      error: { code: 'JUDGMENT_TIMEOUT' },
    })
    expect(rank).toHaveBeenCalledTimes(1)
    expect(fixture.calls).toEqual([{ mode: 'read' }])
  })

  it('records a provider failure result without retrying or dispatching again', async () => {
    const provider = deterministicProvider()
    const rank = vi.fn(async () => { throw new Error('fixture provider failed') })
    provider.rank = rank
    const fixture = setup({ provider })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'JUDGMENT_PROVIDER' })
    expect(fixture.records.find(record => record.type === 'operation/judgment-result')?.data).toMatchObject({
      error: { code: 'JUDGMENT_PROVIDER', message: 'operation judgment request failed: fixture provider failed' },
    })
    expect(rank).toHaveBeenCalledTimes(1)
    expect(fixture.calls).toEqual([{ mode: 'read' }])
  })

  it('rejects a nonpositive tool deadline after synchronous boundary validation consumes wall time', async () => {
    const clock = { now: 1_000 }
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
    let validations = 0
    try {
      const fixture = setup({
        config: { maxWallMs: 100 },
        policy: {
          allowOutputReferences: true,
          validateArguments() {
            validations += 1
            if (validations === 3) clock.now = 1_200
          },
          inspectResult: () => ({ kind: 'complete' }),
        },
      })
      await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'WALL_TIME' })
      expect(fixture.calls).toEqual([])
    } finally {
      now.mockRestore()
    }
  })

  it('checks wall time after judgment request and result durability barriers', async () => {
    const clock = { now: 1_000 }
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
    try {
      for (const expiryFlush of [4, 5]) {
        let flushes = 0
        clock.now = 1_000
        const provider = deterministicProvider()
        const rank = vi.fn(provider.rank.bind(provider))
        provider.rank = rank
        const fixture = setup({
          provider,
          config: { maxWallMs: 100 },
          flush: () => {
            flushes += 1
            if (flushes === expiryFlush) clock.now = 1_200
            return true
          },
        })
        await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'WALL_TIME' })
        expect(rank).toHaveBeenCalledTimes(expiryFlush === 4 ? 0 : 1)
        expect(fixture.records.at(-1)).toMatchObject({ type: 'operation/run-end', data: { status: 'failed' } })
        const judgment = fixture.records.find(record => record.type === 'operation/judgment-result')
        if (expiryFlush === 4) expect(judgment?.data).toMatchObject({ error: { code: 'WALL_TIME' } })
        else expect(judgment?.data).toHaveProperty('response')
      }
    } finally {
      now.mockRestore()
    }
  })

  it('retains a valid judgment response before failing its output-token budget', async () => {
    const provider = deterministicProvider()
    provider.rank = async (prepared) => {
      const leading = prepared.draft.candidates.find(candidate => candidate.kind === 'continue' || candidate.kind === 'complete')
      if (leading === undefined) throw new Error('fixture provider requires one autonomous candidate')
      const remainder = prepared.draft.candidates.filter(candidate => candidate.id !== leading.id)
      return {
        requestId: prepared.draft.id,
        identity,
        probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [
          candidate.id,
          candidate.id === leading.id ? 0.9 : 0.1 / remainder.length,
        ])),
        usage: { billingUnits: 1, inputTokens: 1, outputTokens: 2 },
      }
    }
    const fixture = setup({ provider, config: { maxJudgmentOutputTokens: 1 } })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'JUDGMENT_TOKEN_BUDGET' })
    const response = fixture.records.find(record => record.type === 'operation/judgment-result')?.data as { response?: { usage?: { outputTokens: number } } }
    expect(response.response?.usage?.outputTokens).toBe(2)
    const replay = replayOperation(fixture.records.map((record, seq) => ({ ...record, seq, time: seq })) as never)
    expect(replay).toMatchObject({ status: 'failed', judgments: [{ response: { usage: { outputTokens: 2 } } }] })
    expect(fixture.calls).toEqual([{ mode: 'read' }])
  })

  it('stops inspected failures and returns incomplete evidence without semantic inference', async () => {
    const failedProvider = deterministicProvider()
    const failedRank = vi.fn(failedProvider.rank.bind(failedProvider))
    failedProvider.rank = failedRank
    const failed = setup({
      provider: failedProvider,
      policy: { allowOutputReferences: true, validateArguments() {}, inspectResult: () => ({ kind: 'failed', reason: 'trusted process failure' }) },
    })
    await expect(failed.runner.run(failed.exec, plan())).rejects.toMatchObject({ code: 'PROCESS_FAILED' })
    expect(failedRank).not.toHaveBeenCalled()
    expect(failed.calls).toHaveLength(1)

    const incompleteProvider = deterministicProvider()
    const incompleteRank = vi.fn(incompleteProvider.rank.bind(incompleteProvider))
    incompleteProvider.rank = incompleteRank
    const incomplete = setup({
      provider: incompleteProvider,
      policy: { allowOutputReferences: true, validateArguments() {}, inspectResult: () => ({ kind: 'incomplete', reason: 'trusted evidence is truncated' }) },
    })
    await expect(incomplete.runner.run(incomplete.exec, plan())).resolves.toMatchObject({
      status: 'needs-replan', reason: 'trusted evidence is truncated',
    })
    expect(incompleteRank).not.toHaveBeenCalled()
    expect(incomplete.calls).toHaveLength(1)
  })

  it('rejects output-derived arguments when the exact tool policy forbids them', async () => {
    const fixture = setup({
      policy: { allowOutputReferences: false, validateArguments() {}, inspectResult: () => ({ kind: 'complete' }) },
    })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'TOOL_POLICY' })
    expect(fixture.calls).toEqual([])
  })

  it('applies trusted policy validation to every statically resolvable step before effects', async () => {
    const candidate = plan() as { steps: Array<{ arguments: JsonValue }> }
    candidate.steps[1]!.arguments = { kind: 'literal', value: { target: 'forbidden' } }
    const fixture = setup({
      policy: {
        allowOutputReferences: true,
        validateArguments(args) {
          if (typeof args === 'object' && args !== null && !Array.isArray(args) && args.target === 'forbidden') {
            throw new Error('fixture target is not operation-safe')
          }
        },
        inspectResult: () => ({ kind: 'complete' }),
      },
    })
    await expect(fixture.runner.run(fixture.exec, candidate)).rejects.toMatchObject({ code: 'TOOL_POLICY' })
    expect(fixture.calls).toEqual([])
  })

  it('records only bounded omission metadata for an oversized canonical result and renderer', async () => {
    const marker = 'oversized-secret-marker'
    const fixture = setup({
      config: { maxResultBytes: 128 },
      execute: async () => success({ choices: [{ target: marker.repeat(100) }] }),
    })
    await expect(fixture.runner.run(fixture.exec, plan())).rejects.toMatchObject({ code: 'RESULT_LIMIT' })
    const record = fixture.records.find(entry => entry.type === 'operation/step-result') as {
      data?: { value?: JsonValue; rendered?: JsonValue }
    } | undefined
    expect(record?.data?.value).toBeUndefined()
    expect(JSON.stringify(record?.data?.rendered)).toContain('canonical result omitted')
    expect(JSON.stringify(record?.data)).not.toContain(marker)
  })
})
