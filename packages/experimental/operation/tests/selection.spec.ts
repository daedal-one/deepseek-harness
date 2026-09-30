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
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import OperationService from '../src/index.ts'
import { parseOperationPlan } from '../src/plan.ts'
import { replayOperation } from '../src/replay.ts'
import type { OperationExpression, OperationJudgmentDraft, OperationPlan, OperationPreparedJudgment } from '../src/types.ts'

const literal = (value: JsonValue): OperationExpression => ({ kind: 'literal', value })
const selected = (pointer: string): OperationExpression => ({ kind: 'selected', step: 'read', pointer })
const result = (step: string, pointer: string): OperationExpression => ({ kind: 'result', step, pointer })
const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function plan(selectedAt: 'all' | 'step' | 'completion' | 'evidence' = 'all', selectsArguments = true): OperationPlan {
  return {
    version: 1, name: 'retained-selection', goal: 'verify the selected coherent record', inputs: {},
    steps: [
      {
        id: 'read', purpose: 'read records', tool: 'selection_read', arguments: literal({}),
        assertions: [{ kind: 'present', value: result('read', '/records') }],
        observation: { paths: ['/records'], candidates: '/records' }, question: 'Which record should continue?',
      },
      {
        id: 'verify', purpose: 'verify one selected record', tool: 'selection_verify',
        arguments: selectsArguments
          ? { kind: 'object', properties: { id: selected('/id'), region: selected('/region') } }
          : literal({ id: 'beta', region: 'east' }),
        assertions: selectedAt === 'all' || selectedAt === 'step'
          ? [
            { kind: 'equals', left: selected('/id'), right: result('verify', '/id') },
            { kind: 'equals', left: selected('/region'), right: result('verify', '/region') },
          ]
          : [{ kind: 'equals', left: result('verify', '/ok'), right: literal(true) }],
        observation: { paths: ['/id', '/region', '/ok'] }, question: 'Does the selected record match?',
      },
    ],
    completion: {
      assertions: selectedAt === 'all' || selectedAt === 'completion'
        ? [{ kind: 'equals', left: selected('/id'), right: literal('beta') }]
        : [{ kind: 'equals', left: result('verify', '/ok'), right: literal(true) }],
      evidence: selectedAt === 'all' || selectedAt === 'evidence'
        ? [selected('/id'), selected('/region'), { kind: 'object', properties: { record: selected('') } }]
        : [result('verify', '/id')],
      question: 'Do the checks and selected evidence support completion?',
    },
  }
}

async function runPlan(rawPlan: unknown) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-operation-selection-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(OperationService, { maxWallMs: 10_000 })
  const identity = {
    provider: 'fixture', model: 'fixture', encoder: 'fixture', tokenizer: 'fixture', serialization: 'fixture', deployment: 'fixture',
    deploymentManifest: { reference: 'fixture', digest: 'fixture' }, calibrationId: 'fixture',
  }
  const provider = {
    identity,
    prepare: vi.fn(async (draft: OperationJudgmentDraft) => ({ draft, wire: { request: draft.id }, inputTokens: 1, identity })),
    rank: vi.fn(async (prepared: OperationPreparedJudgment) => {
      const chosen = prepared.draft.candidates.findLast(candidate => candidate.kind === 'continue' || candidate.kind === 'complete')
      if (chosen === undefined) throw new Error('fixture requires an autonomous candidate')
      return {
        requestId: prepared.draft.id, identity,
        probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [
          candidate.id, candidate === chosen ? 0.9 : 0.1 / (prepared.draft.candidates.length - 1),
        ])),
      }
    }),
  }
  ctx.effect(() => ctx.operations.registerJudgmentProvider(provider), 'selection.provider')
  const readBody = vi.fn(async () => ({ records: [{ id: 'alpha', region: 'west' }, { id: 'beta', region: 'east' }] }))
  const verifyBody = vi.fn(async (args: { id: string; region: string }) => ({ ...args, ok: true }))
  const read = defineTool({
    name: 'selection_read', description: 'read records', parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          records: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { id: { type: 'string', required: true }, region: { type: 'string', required: true } },
            },
          },
        },
      },
      render: () => [],
    },
    execute: readBody,
  })
  const verify = defineTool({
    name: 'selection_verify', description: 'verify selected record',
    parameters: { id: { type: 'string', required: true }, region: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string', required: true }, region: { type: 'string', required: true }, ok: { type: 'boolean', required: true } },
      },
      render: () => [],
    },
    execute: verifyBody,
  })
  for (const definition of [read, verify]) {
    ctx.effect(() => ctx.tools.register(definition), `selection.${definition.name}`)
    ctx.effect(() => ctx.operations.toolPolicies.register(definition, {
      allowOutputReferences: true, validateArguments() {}, inspectResult: () => ({ kind: 'complete' }),
    }), `selection.${definition.name}.policy`)
  }
  const dispatched: string[] = []
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name !== 'run_operation') dispatched.push(exec.name)
    return next()
  })
  const agent = await ctx.agentLoop.create(SessionId('selection-agent'), { provider: 'mock', model: 'mock' })
  const outcome = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    callId: ToolCallId('selection-operation'), name: 'run_operation', signal: new AbortController().signal, agent, arguments: { plan: rawPlan },
  }))
  return {
    outcome, provider, readBody, verifyBody, dispatched,
    events: agent.session.snapshotEvents().filter(event => event.type.startsWith('operation/')),
  }
}

describe('retained operation selection', () => {
  it('uses the accepted second record in step assertions, completion assertions and evidence, with pure replay agreement', async () => {
    const fixture = await runPlan(plan())
    expect(fixture.outcome).toMatchObject({ isError: false, value: { status: 'completed' } })
    expect(fixture.verifyBody).toHaveBeenCalledWith({ id: 'beta', region: 'east' }, expect.anything())
    const stepResult = fixture.events.find(event => event.type === 'operation/step-result' && event.data.stepId === 'verify')
    expect(stepResult?.data).toMatchObject({ assertions: [{ passed: true }, { passed: true }] })
    const completion = fixture.events.find(event => event.type === 'operation/judgment-request' && event.data.request.draft.kind === 'completion')
    expect(completion?.data).toMatchObject({
      request: { draft: { state: { completionEvidence: ['beta', 'east', { record: { id: 'beta', region: 'east' } }] } } },
    })
    const replay = replayOperation(fixture.events)
    expect(replay.status).toBe('completed')
    expect(replay.steps[1]).toMatchObject({
      arguments: { id: 'beta', region: 'east' }, result: { assertions: [{ passed: true }, { passed: true }] },
    })
    expect(replay.transitions[0]).toMatchObject({ candidateId: 'continue-1', arguments: { id: 'beta', region: 'east' } })
    expect(replay.terminal?.verification).toEqual([{ index: 0, passed: true, reason: 'passed' }])
    expect(fixture.readBody).toHaveBeenCalledTimes(1)
    expect(fixture.verifyBody).toHaveBeenCalledTimes(1)
    expect(fixture.provider.prepare).toHaveBeenCalledTimes(2)
    expect(fixture.provider.rank).toHaveBeenCalledTimes(2)
    for (let length = 1; length < fixture.events.length; length += 1) {
      expect(replayOperation(fixture.events.slice(0, length)).status).toBe('interrupted')
    }
  })

  it.each(['step', 'completion', 'evidence'] as const)('rejects selected references in %s when arguments never select a source, before any effects or records', async (location) => {
    const invalid = plan(location, false)
    expect(() => parseOperationPlan(invalid)).toThrow("current step's arguments to select the same source")
    const fixture = await runPlan(invalid)
    expect(fixture.outcome.isError).toBe(true)
    if (!fixture.outcome.isError) throw new Error('expected selection admission denial')
    expect(fixture.outcome.error.message).toContain("current step's arguments to select the same source")
    expect(fixture.dispatched).toEqual([])
    expect(fixture.events).toEqual([])
    expect(fixture.readBody).not.toHaveBeenCalled()
    expect(fixture.verifyBody).not.toHaveBeenCalled()
    expect(fixture.provider.prepare).not.toHaveBeenCalled()
    expect(fixture.provider.rank).not.toHaveBeenCalled()
  })

  it('does not widen selected references beyond the immediately preceding step', () => {
    const original = plan()
    const last = original.steps[1]
    if (last === undefined) throw new Error('fixture requires its second step')
    expect(() => parseOperationPlan({
      ...original,
      steps: [...original.steps, { ...last, id: 'third', arguments: literal({ id: 'beta', region: 'east' }) }],
    })).toThrow('selected reference must name the immediately preceding step')
    expect(() => parseOperationPlan({
      ...original,
      steps: [original.steps[0], {
        ...last, assertions: [{ kind: 'present', value: { kind: 'selected', step: 'verify', pointer: '/id' } }],
      }],
    })).toThrow('selected reference must name the immediately preceding step')
  })
})
