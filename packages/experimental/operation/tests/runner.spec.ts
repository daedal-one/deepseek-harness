import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { OperationJudgmentRegistry } from '../src/judgment.ts'
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

function setup(options: {
  flush?: () => boolean
  provider?: OperationJudgmentProvider
  signal?: AbortSignal
  config?: OperationConfig
  execute?: (input: { arguments: JsonValue }) => Promise<unknown>
} = {}) {
  const records: Array<{ type: string; data: unknown }> = []
  const flushes: string[][] = []
  const calls: JsonValue[] = []
  const session = { append: (type: string, data: unknown) => { records.push({ type, data }) } }
  const tools = {
    admitted: () => definition,
    execute: async (input: { arguments: JsonValue }) => {
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
  const runner = new OperationRunner(ctx, judgments, { maxWallMs: 10_000, ...options.config })
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
    expect(fixture.flushes[3]?.slice(-3)).toEqual(['operation/judgment-result', 'operation/transition', 'operation/step-start'])

    const interrupted = replayOperation(fixture.records.slice(0, 2).map((record, seq) => ({ ...record, seq, time: seq })) as never)
    expect(interrupted).toMatchObject({ status: 'interrupted', steps: [{ stepId: 'read', outcome: 'unknown' }] })
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
    expect(fixture.records.at(-1)?.type).toBe('operation/run-end')
  })
})
