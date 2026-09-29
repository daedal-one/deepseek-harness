import { afterEach, describe, expect, it } from 'vitest'
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
import OperationService from '../src/index.ts'
import type { OperationJudgmentProvider } from '../src/types.ts'

const roots: string[] = []
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

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('operation opt-in composition', () => {
  it('dispatches planned nested tools through the real tool registry and persists replayable records', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const root = mkdtempSync(join(tmpdir(), 'dsh-operation-'))
    roots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(OperationService, { maxWallMs: 10_000 })
    ctx.effect(() => ctx.operations.registerJudgmentProvider(provider), 'operation-test.provider')
    const observed: string[] = []
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'read_fixture', description: 'read fixture', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { choices: { type: 'array', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute() { observed.push('read'); return { choices: [{ target: 'alpha' }] } },
    })), 'operation-test.read')
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'act_fixture', description: 'act fixture', parameters: { target: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args) { observed.push(args.target); return { ok: true } },
    })), 'operation-test.act')
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
})
