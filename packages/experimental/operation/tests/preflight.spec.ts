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
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import OperationService from '../src/index.ts'
import { parseOperationPlan } from '../src/plan.ts'
import { preflightOperationPlan } from '../src/preflight.ts'
import type { OperationAssertion, OperationExpression, OperationJudgmentDraft, OperationPreparedJudgment } from '../src/types.ts'

const result = (pointer: string): OperationExpression => ({ kind: 'result', step: 'read', pointer })
const selected = (pointer: string): OperationExpression => ({ kind: 'selected', step: 'read', pointer })
const literal = (value: JsonValue): OperationExpression => ({ kind: 'literal', value })
const object = (properties: Record<string, OperationExpression>): OperationExpression => ({ kind: 'object', properties })
const inputSchema: JsonSchemaNode = { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false }
const recordSchema: JsonSchemaNode = {
  type: 'object', properties: { target: { type: 'string' }, port: { type: 'integer' } }, required: ['target', 'port'], additionalProperties: false,
}
const outputSchema: JsonSchemaNode = {
  type: 'object',
  properties: {
    target: { type: 'string' }, count: { type: 'integer' }, nullable: { type: 'null' }, flag: { type: 'boolean' },
    records: { type: 'array', items: recordSchema }, flags: { type: 'array', items: { type: 'boolean' } },
    'a/b': { type: 'object', properties: { '~key': { type: 'string' } }, additionalProperties: false },
  },
  required: ['target', 'count', 'nullable', 'flag', 'records', 'flags', 'a/b'],
  additionalProperties: false,
}

function fixture(options: {
  output?: JsonSchemaNode
  input?: JsonSchemaNode
  arguments?: OperationExpression
  assertions?: readonly OperationAssertion[]
  paths?: readonly string[]
  candidates?: string
  evidence?: readonly OperationExpression[]
  completionAssertions?: readonly OperationAssertion[]
} = {}) {
  const read = {
    name: 'preflight_read', description: 'read deterministic records', parameters: { type: 'object' },
    output: { schema: options.output ?? outputSchema, render: () => [] },
    execute: vi.fn(async () => ({
      target: 'alpha', count: 2, nullable: null, flag: true,
      records: [{ target: 'alpha', port: 80 }, { target: 'beta', port: 443 }], flags: [true], 'a/b': { '~key': 'escaped' },
    })),
  } satisfies ToolDefinition
  const act = {
    name: 'preflight_act', description: 'consume deterministic records', parameters: { ...(options.input ?? inputSchema) },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, render: () => [] },
    execute: vi.fn(async () => ({ ok: true })),
  } satisfies ToolDefinition
  const plan = parseOperationPlan({
    version: 1, name: 'preflight', goal: 'check declared references before effects', inputs: { known: { valid: 'input', wrong: false, nullable: null } },
    steps: [
      {
        id: 'read', purpose: 'read', tool: read.name, arguments: literal({}),
        assertions: options.assertions ?? [{ kind: 'present', value: result('') }],
        observation: { paths: options.paths ?? [''], ...(options.candidates === undefined ? {} : { candidates: options.candidates }) }, question: 'Continue?',
      },
      {
        id: 'act', purpose: 'consume', tool: act.name, arguments: options.arguments ?? object({ target: result('/target') }),
        assertions: [{ kind: 'present', value: { kind: 'result', step: 'act', pointer: '/ok' } }], observation: { paths: ['/ok'] }, question: 'Continue?',
      },
    ],
    completion: {
      assertions: options.completionAssertions ?? [{ kind: 'present', value: { kind: 'result', step: 'act', pointer: '/ok' } }],
      evidence: options.evidence ?? [{ kind: 'result', step: 'act', pointer: '/ok' }], question: 'Complete?',
    },
  })
  const admitted = new Map([['read', { definition: read }], ['act', { definition: act }]])
  return { plan, admitted, read, act, check: () => { preflightOperationPlan(plan, admitted) } }
}

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function runThroughRegistry(value: ReturnType<typeof fixture>) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-operation-preflight-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(OperationService, { maxWallMs: 10_000 })
  const identity = {
    provider: 'deterministic', model: 'fixture', encoder: 'fixture', tokenizer: 'fixture', serialization: 'fixture', deployment: 'fixture',
    deploymentManifest: { reference: 'fixture', digest: 'fixture' }, calibrationId: 'fixture',
  }
  const provider = {
    identity,
    prepare: vi.fn(async (draft: OperationJudgmentDraft) => ({ draft, wire: { request: draft.id }, inputTokens: 1, identity })),
    rank: vi.fn(async (prepared: OperationPreparedJudgment) => {
      const chosen = prepared.draft.candidates.findLast(candidate => candidate.kind === 'continue' || candidate.kind === 'complete')
      if (chosen === undefined) throw new Error('fixture requires an autonomous choice')
      return {
        requestId: prepared.draft.id, identity,
        probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [
          candidate.id, candidate === chosen ? 0.9 : 0.1 / (prepared.draft.candidates.length - 1),
        ])),
      }
    }),
  }
  ctx.effect(() => ctx.operations.registerJudgmentProvider(provider), 'preflight.provider')
  for (const definition of [value.read, value.act]) {
    ctx.effect(() => ctx.tools.register(definition), `preflight.${definition.name}`)
    ctx.effect(() => ctx.operations.toolPolicies.register(definition, {
      allowOutputReferences: true, validateArguments() {}, inspectResult: () => ({ kind: 'complete' }),
    }), `preflight.${definition.name}.policy`)
  }
  const dispatched: string[] = []
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name !== 'run_operation') dispatched.push(exec.name)
    return next()
  })
  const agent = await ctx.agentLoop.create(SessionId('preflight-agent'), { provider: 'mock', model: 'mock' })
  const outcome = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    callId: ToolCallId('preflight-operation'), name: 'run_operation', signal: new AbortController().signal, agent, arguments: { plan: value.plan },
  }))
  return { outcome, provider, dispatched, events: agent.session.snapshotEvents().filter(event => event.type.startsWith('operation/')) }
}

describe('operation schema preflight', () => {
  it.each(['/missing', '/target/nested', '/nullable/nested', '/flags/length', '/flags/01', '/flags/-', '/flags/-1', '/flags/9007199254740992'])('rejects impossible result pointer %s', (pointer) => {
    expect(fixture({ arguments: object({ target: result(pointer) }) }).check).toThrow('JSON Pointer')
  })

  it('checks observations and completion evidence before dispatch', () => {
    expect(fixture({ paths: ['/missing'] }).check).toThrow('JSON Pointer')
    expect(fixture({ candidates: '/missing' }).check).toThrow('JSON Pointer')
    expect(fixture({ evidence: [result('/missing')] }).check).toThrow('JSON Pointer')
    expect(fixture({ completionAssertions: [{ kind: 'present', value: result('/missing') }] }).check).toThrow('JSON Pointer')
  })

  it('rejects selected member paths and types using the declared candidate item schema', () => {
    expect(fixture({ candidates: '/records', arguments: object({ target: selected('/missing') }) }).check).toThrow('selected record')
    expect(fixture({ candidates: '/records', arguments: object({ target: selected('/port') }) }).check).toThrow('input schema')
    expect(fixture({ candidates: '/target', arguments: object({ target: selected('') }) }).check).toThrow('cannot be an array')
    expect(fixture({ candidates: '/flags', arguments: object({ target: selected('/target') }) }).check).toThrow('selected record')
  })

  it.each([
    { arguments: object({ target: result('/count') }) },
    { arguments: object({ other: result('/target') }) },
    { arguments: object({ target: result('/target'), extra: literal(true) }) },
    { arguments: { kind: 'array', items: [result('/target')] } as OperationExpression },
    { input: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } } } as JsonSchemaNode, arguments: object({ values: { kind: 'array', items: [result('/count'), literal(false)] } }) },
    { input: { type: 'object', properties: { nested: inputSchema } } as JsonSchemaNode, arguments: object({ nested: object({ target: result('/count') }) }) },
  ])('rejects incompatible mixed expression shape %#', (options) => {
    expect(fixture(options).check).toThrow('input schema')
  })

  it('validates literal and input leaves inside mixed dynamic expressions', () => {
    const input: JsonSchemaNode = { type: 'object', properties: { target: { type: 'string' }, fixed: { type: 'string', enum: ['allowed'] } } }
    expect(fixture({ input, arguments: object({ target: result('/target'), fixed: literal('forbidden') }) }).check).toThrow('input schema')
    expect(fixture({ input, arguments: object({ target: result('/target'), fixed: { kind: 'input', input: 'known', pointer: '/wrong' } }) }).check).toThrow('input schema')
    expect(fixture({ input, arguments: object({ target: result('/target'), fixed: { kind: 'input', input: 'known', pointer: '/missing' } }) }).check).toThrow('missing JSON Pointer')
  })

  it('distinguishes explicit null from absent input and result properties', () => {
    const input: JsonSchemaNode = { type: 'object', properties: { target: { type: 'null' }, fixed: { type: 'null' } }, required: ['target', 'fixed'] }
    expect(fixture({ input, arguments: object({ target: result('/nullable'), fixed: { kind: 'input', input: 'known', pointer: '/nullable' } }) }).check).not.toThrow()
    expect(fixture({ arguments: object({ target: result('/nullable') }) }).check).toThrow('input schema')
  })

  it('decodes escaped pointer segments and does not confuse numeric object keys with array indexes', () => {
    expect(fixture({ arguments: object({ target: result('/a~1b/~0key') }) }).check).not.toThrow()
    expect(fixture({ output: { type: 'object', properties: { '01': { type: 'string' } }, additionalProperties: false }, arguments: object({ target: result('/01') }) }).check).not.toThrow()
    expect(fixture({ output: { type: 'object', properties: { '': { type: 'string' } }, additionalProperties: false }, arguments: object({ target: result('/') }) }).check).not.toThrow()
  })

  it('retains required versus optional property semantics when comparing records', () => {
    const source: JsonSchemaNode = { type: 'object', properties: { target: { type: 'number' } }, additionalProperties: false }
    const optional: JsonSchemaNode = { type: 'object', properties: { target: { type: 'string' } }, additionalProperties: false }
    expect(fixture({ output: source, input: optional, arguments: result('') }).check).not.toThrow()
    expect(fixture({ output: source, input: inputSchema, arguments: result('') }).check).toThrow('input schema')
    expect(fixture({ output: { type: 'object', additionalProperties: false }, input: inputSchema, arguments: result('') }).check).toThrow('input schema')
    expect(fixture({ output: { type: 'object', properties: { target: { type: 'string' } }, additionalProperties: false } }).check).not.toThrow()
  })

  it('does not mistake numeric overlap or possibly empty arrays for impossibility', () => {
    expect(fixture({ input: { type: 'object', properties: { target: { type: 'number' } } }, arguments: object({ target: result('/count') }) }).check).not.toThrow()
    expect(fixture({ output: { type: 'number' }, input: { type: 'integer' }, arguments: result('') }).check).not.toThrow()
    expect(fixture({ output: { type: 'array', items: { type: 'string' } }, input: { type: 'array', items: { type: 'number' } }, arguments: result('') }).check).not.toThrow()
    expect(fixture({ output: { type: 'array', items: { type: 'string' } }, arguments: object({ target: result('/999999') }) }).check).not.toThrow()
  })

  it('rejects incompatible finite scalar constraints using maintained validation', () => {
    expect(fixture({ output: { type: 'string', enum: ['alpha', 'beta'] }, input: { type: 'string', const: 'gamma' }, arguments: result('') }).check).toThrow('input schema')
    expect(fixture({ output: { type: 'number', const: 1.5 }, input: { type: 'integer' }, arguments: result('') }).check).toThrow('input schema')
    expect(fixture({ output: { type: 'string' }, input: { type: 'string', const: 'alpha' }, arguments: result('') }).check).not.toThrow()
  })

  it.each([
    {}, true, false, { $ref: '#/$defs/record', $defs: { record: recordSchema } },
    { type: 'object', patternProperties: { '^x': { type: 'string' } }, additionalProperties: false },
    { type: ['string', 'object'] }, { allOf: [recordSchema] },
  ])('treats unsupported or unconstrained schema %# as unknown rather than impossible', (raw) => {
    // Deliberately bypass registry schema admission to exercise the helper's
    // conservative behavior for forms outside the maintained schema subset.
    const schema = raw as JsonSchemaNode
    expect(fixture({ output: schema, arguments: object({ target: result('/unknown/deep/path') }) }).check).not.toThrow()
    expect(fixture({ input: schema, arguments: object({ target: result('/count'), literal: literal(false) }) }).check).not.toThrow()
  })

  it('keeps open records, untyped array items and optional properties uncertain', () => {
    expect(fixture({ output: { type: 'object' }, arguments: object({ target: result('/future/nested') }) }).check).not.toThrow()
    expect(fixture({ output: { type: 'array' }, candidates: '', arguments: object({ target: selected('/future/nested') }) }).check).not.toThrow()
    expect(fixture({ output: { type: 'object', properties: { target: { type: 'string' } } } }).check).not.toThrow()
    expect(fixture({ output: { type: 'object', additionalProperties: false }, arguments: object({ target: result('/toString') }) }).check).toThrow('JSON Pointer')
  })

  it('rejects unions only when every possible branch is incompatible', () => {
    const output: JsonSchemaNode = { oneOf: [
      { type: 'object', properties: { target: { type: 'number' } }, additionalProperties: false },
      { type: 'object', properties: { target: { type: 'string' } }, additionalProperties: false },
    ] }
    expect(fixture({ output }).check).not.toThrow()
    expect(fixture({ output, arguments: object({ target: result('/missing') }) }).check).toThrow('JSON Pointer')
    expect(fixture({ input: { oneOf: [inputSchema, { type: 'array' }] } }).check).not.toThrow()
    expect(fixture({ input: { oneOf: [{ type: 'boolean' }, { type: 'array' }] } }).check).toThrow('input schema')
    const overlappingProjection: JsonSchemaNode = { oneOf: [
      { type: 'object', properties: { tag: { type: 'string', const: 'a' }, target: { type: 'string' } }, required: ['tag'] },
      { type: 'object', properties: { tag: { type: 'string', const: 'b' }, target: { type: 'string' } }, required: ['tag'] },
    ] }
    expect(fixture({ output: overlappingProjection, assertions: [{ kind: 'equals', left: result('/target'), right: literal('alpha') }] }).check).not.toThrow()
  })

  it('never rejects schema pairs with a concrete shared witness accepted by the maintained validator', () => {
    const schemas: JsonSchemaNode[] = [
      {}, { type: 'null' }, { type: 'boolean' }, { type: 'string' }, { type: 'string', enum: ['alpha'] },
      { type: 'number' }, { type: 'integer' }, { type: 'number', const: 1.5 },
      { type: 'array', items: { type: 'number' } }, { type: 'array', items: { type: 'string' } },
      { type: 'object' }, { type: 'object', additionalProperties: false }, inputSchema,
      { type: 'object', properties: { target: { type: 'number' } }, additionalProperties: false },
      { oneOf: [{ type: 'number' }, { type: 'integer' }] }, { oneOf: [inputSchema, { type: 'array' }] },
    ]
    const witnesses: JsonValue[] = [null, false, true, 'alpha', 'beta', 1, 1.5, [], [1], ['alpha'], {}, { target: 'alpha' }, { target: 1 }]
    for (const output of schemas) {
      for (const input of schemas) {
        const shared = witnesses.some(value => validateJsonSchemaValue(output, value).length === 0
          && validateJsonSchemaValue(input, value).length === 0)
        if (shared) expect(fixture({ output, input, arguments: result('') }).check).not.toThrow()
      }
    }
  })

  it.each<OperationAssertion>([
    { kind: 'type', value: result('/target'), type: 'number' },
    { kind: 'number', value: result('/target'), min: 0 },
    { kind: 'size', value: result('/flag'), min: 0 },
    { kind: 'equals', left: result('/count'), right: literal('two') },
    { kind: 'equals', left: result('/count'), right: result('/target') },
    { kind: 'oneOf', value: result('/count'), values: [true, 'two'] },
    { kind: 'number', value: literal(3), max: 2 },
    { kind: 'size', value: object({ fixed: literal(true) }), max: 0 },
    { kind: 'type', value: { kind: 'array', items: [literal(true)] }, type: 'string' },
    { kind: 'oneOf', value: object({ target: result('/target') }), values: [{ target: false }] },
    { kind: 'oneOf', value: { kind: 'array', items: [result('/target')] }, values: [[], [false]] },
  ])('rejects schema-proven or known impossible primitive assertion %#', (assertion) => {
    expect(fixture({ assertions: [assertion] }).check).toThrow('assertion 0 cannot pass')
  })

  it('admits potentially passing primitive assertions without promising their result', () => {
    expect(fixture({ assertions: [
      { kind: 'type', value: result('/count'), type: 'number' },
      { kind: 'number', value: result('/count'), min: 10 },
      { kind: 'size', value: result('/target'), min: 0 },
      { kind: 'equals', left: result('/target'), right: literal('alpha') },
      { kind: 'oneOf', value: result('/nullable'), values: [null] },
      { kind: 'oneOf', value: object({ target: result('/target') }), values: [{ target: 'alpha' }] },
      { kind: 'oneOf', value: { kind: 'array', items: [result('/target')] }, values: [['alpha']] },
    ] }).check).not.toThrow()
  })

  it.each([
    { arguments: object({ target: result('/missing') }) },
    { arguments: object({ target: result('/count') }) },
    { candidates: '/records', arguments: object({ target: selected('/missing') }) },
    { arguments: object({ wrong: result('/target') }) },
    { input: { type: 'object', properties: { target: { type: 'string' }, fixed: { type: 'string' } } } as JsonSchemaNode, arguments: object({ target: result('/target'), fixed: literal(false) }) },
    { assertions: [{ kind: 'type', value: result('/count'), type: 'string' }] as const },
  ])('rejects impossible plan %# through real ToolRuntime before nested policy, effects, records or inference', async (options) => {
    const value = fixture(options)
    const executed = await runThroughRegistry(value)
    expect(executed.outcome.isError).toBe(true)
    if (!executed.outcome.isError) throw new Error('expected preflight denial')
    expect(executed.outcome.error.message).toMatch(/impossible|cannot/)
    expect(value.read.execute).not.toHaveBeenCalled()
    expect(value.act.execute).not.toHaveBeenCalled()
    expect(executed.dispatched).toEqual([])
    expect(executed.events).toEqual([])
    expect(executed.provider.prepare).not.toHaveBeenCalled()
    expect(executed.provider.rank).not.toHaveBeenCalled()
  })

  it('admits valid selected records and preserves coherent arguments in real ToolRuntime', async () => {
    const value = fixture({ input: recordSchema, candidates: '/records', arguments: object({ target: selected('/target'), port: selected('/port') }) })
    const executed = await runThroughRegistry(value)
    expect(executed.outcome).toMatchObject({ isError: false, value: { status: 'completed' } })
    expect(value.act.execute).toHaveBeenCalledWith({ target: 'beta', port: 443 }, expect.anything())
    expect(executed.provider.rank).toHaveBeenCalledTimes(2)
    expect(executed.events[0]?.type).toBe('operation/run-start')
  })

  it('retains concrete argument validation when an open output schema cannot prove a mismatch', async () => {
    const value = fixture({ output: { type: 'object' }, arguments: object({ target: result('/count') }) })
    expect(value.check).not.toThrow()
    const executed = await runThroughRegistry(value)
    expect(executed.outcome).toMatchObject({ isError: false, value: { status: 'needs-replan' } })
    expect(value.read.execute).toHaveBeenCalledTimes(1)
    expect(value.act.execute).not.toHaveBeenCalled()
    expect(executed.provider.rank).toHaveBeenCalledTimes(1)
  })
})
