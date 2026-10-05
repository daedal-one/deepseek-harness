import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as toolFs from '@deepseek-ai/dsh-tool-fs'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import OperationService, { type OperationJudgmentProvider } from '../src/index.ts'
import * as operationAgent from '../src/agent.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const identity = { provider: 'fixture', model: 'fixture', encoder: 'fixture', tokenizer: 'fixture', serialization: 'fixture',
  deployment: 'fixture', deploymentManifest: { reference: 'fixture-only', digest: 'fixture-only' } } as const
const provider: OperationJudgmentProvider = {
  identity,
  async prepare(draft) { return { draft, wire: { id: draft.id }, identity, inputTokens: 1 } },
  async rank(prepared) {
    const choice = prepared.draft.candidates.find(candidate => candidate.kind === 'continue' || candidate.kind === 'complete')!
    return { requestId: prepared.draft.id, identity, usage: { inputTokens: 1, outputTokens: 0 },
      probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [candidate.id, candidate === choice ? 1 : 0])) }
  },
}

async function setup(maxCatalogBytes = 65_536, lateTool = false, inventory: 'all' | string[] = 'all',
  definitions: ToolDefinition[] = [], conflictingPolicy = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-operation-agent-'))
  roots.push(root)
  const preset = join(root, 'presets', 'operation')
  await mkdir(preset, { recursive: true })
  await writeFile(join(root, 'source.txt'), 'alpha\nbeta\ngamma\n')
  await writeFile(join(preset, 'agent.cordis.yml'), JSON.stringify([
    { name: 'cordis:fixture-fs', disabled: definitions.some(definition => definition.name === 'read') },
    { name: 'cordis:fixture-actions' },
    { id: 'operations', name: 'cordis:group', group: true, isolate: { operations: true, operationJudgments: true }, config: [
      { name: 'cordis:fixture-operations', config: { requireCalibration: false, returnObservations: true } },
      { name: 'cordis:fixture-provider' },
      { name: 'cordis:fixture-agent', config: { tools: inventory, maxMutationBytes: 32, maxCatalogBytes } },
    ] },
    ...(lateTool ? [{ name: 'cordis:fixture-late' }] : []),
  ]))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  ctx.loader.builtins['fixture-fs'] = toolFs
  ctx.loader.builtins['fixture-operations'] = OperationService
  ctx.loader.builtins['fixture-agent'] = operationAgent
  ctx.loader.builtins['fixture-actions'] = { inject: ['tools'], apply(ctx: Context) {
    for (const definition of definitions) ctx.effect(() => ctx.tools.register(definition))
  } }
  let operations: OperationService | undefined
  ctx.loader.builtins['fixture-provider'] = { inject: ['operations', 'tools'], apply(ctx: Context) {
    operations = ctx.operations
    ctx.effect(() => ctx.operations.registerJudgmentProvider(provider))
    if (conflictingPolicy) ctx.effect(() => ctx.operations.toolPolicies.register(ctx.tools.get('write', scopeOf(ctx))!, {
      allowOutputReferences: false, validateArguments() {}, inspectResult() { return { kind: 'complete' } },
    }))
  } }
  ctx.loader.builtins['fixture-late'] = { inject: ['tools'], async apply(ctx: Context) {
    await readFile(join(root, 'source.txt'), 'utf8')
    ctx.effect(() => ctx.tools.register(defineTool({ name: 'probe', description: 'Read the loaded fixture', parameters: {},
      output: { schema: { type: 'string' }, render: () => [] }, async execute() { return 'loaded' } })))
  } }
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(AgentPresets, { default: 'operation', roots: [{ path: join(root, 'presets'), trust: 'system' }],
    includeShippedRoot: false, includeUserRoot: false })
  const handle = await ctx.agents.create({ sessionId: SessionId('operation-profile'), meta: { cwd: root, agentPreset: 'operation' },
    setup: async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx, 'operation') } })
  return { ctx, agent: handle.agent, root, operations: operations! }
}

function plan(tool: string, args: unknown, pointer: string) {
  const result = { kind: 'result', step: 'action', pointer }
  return { version: 1, name: 'inspect-or-edit', goal: 'Perform the declared action and inspect its result', inputs: {}, steps: [{
    id: 'action', tool, purpose: 'Perform action', arguments: { kind: 'literal', value: args },
    assertions: [{ kind: 'present', value: result }], observation: { paths: [pointer] }, question: 'Is the action settled?',
  }], completion: { assertions: [{ kind: 'present', value: result }], evidence: [result], question: 'Is the declared action complete?' } }
}
async function execute(ctx: Context, agent: Agent, name: string, args: unknown) {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({ name, arguments: args, agent,
    callId: ToolCallId(`call-${agent.session.seq}`), signal: new AbortController().signal }))
}

function action(name: string, value: JsonValue) {
  return defineTool({ name, description: 'Canonical fixture action', parameters: {},
    output: { schema: { type: 'json' }, render: () => [] }, async execute() { return value } })
}

describe('operation-only coding preset through the real Loader', () => {
  it('requires an agent-scoped selector', () => {
    const ctx = new Context()
    contexts.push(ctx)
    expect(() => { operationAgent.apply(ctx, { tools: 'all', maxMutationBytes: 32, maxCatalogBytes: 65_536 }) })
      .toThrow('agent-scoped')
  })
  it.each([[], ['read', 'read'], ['missing'], ['run_operation'], ['run_code']].map(inventory => ({ inventory })))('rejects an invalid inventory $inventory', async ({ inventory }) => {
    const { ctx, agent } = await setup(65_536, false, inventory)
    await expect(ctx.systemPrompt.assemble(assembleContextFor(agent))).rejects.toThrow()
  })
  it('assembles a selected catalog for a scoped caller without an Agent', async () => {
    const { ctx, agent } = await setup(65_536, false, ['read'])
    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(agent.ctx)! })
    const catalog = assembly.sections.find(section => section.name === 'operation:plan')!.text
    expect(catalog).toContain('"name":"read"')
    expect(catalog).not.toContain('"name":"write"')
  })
  it('rolls back partial policy binding on a duplicate registration', async () => {
    const { ctx, agent, operations } = await setup(65_536, false, ['read', 'write'], [], true)
    const read = agent.ctx.tools.get('read', scopeOf(agent.ctx))!
    await expect(ctx.systemPrompt.assemble(assembleContextFor(agent))).rejects.toThrow('already registered')
    expect(() => operations.toolPolicies.require(read)).toThrow('no trusted operation policy')
  })
  it.each(['bash', 'pwsh'])('applies foreground outcome checks to %s', async (name) => {
    const { ctx, agent } = await setup(65_536, false, 'all', [action(name, {
      kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false,
      stdout: { text: 'settled', truncated: false }, stderr: { text: '', truncated: false },
    })])
    const result = await execute(ctx, agent, 'run_operation', { plan: plan(name, {}, '/stdout/text') })
    expect(result, JSON.stringify(result))
      .toMatchObject({ isError: false, value: { status: 'completed' } })
  })
  it.each([{ run_in_background: true }, { background: true }, null, 'invalid', []].map(args => ({ args })))('rejects nonforeground or nonobject action arguments $args', async ({ args }) => {
    const { ctx, agent } = await setup(65_536, false, 'all', [action('probe', { settled: true })])
    expect(await execute(ctx, agent, 'run_operation', { plan: plan('probe', args, '') }))
      .toMatchObject({ isError: true })
  })
  it.each([{ kind: 'background' }, { running: true }, { status: 'running' }, { status: 'pending' }])('returns pending outcomes for replanning %j', async (value) => {
    const { ctx, agent } = await setup(65_536, false, 'all', [action('probe', value)])
    const result = await execute(ctx, agent, 'run_operation', { plan: plan('probe', {}, '') })
    expect(result, JSON.stringify(result))
      .toMatchObject({ isError: false, value: { status: 'needs-replan' } })
  })
  it.each([{ truncatedByBytes: true }, { truncatedLineNumbers: [1] }])('returns incomplete read evidence for replanning %j', async (value) => {
    const { ctx, agent } = await setup(65_536, false, 'all', [action('read', value)])
    const result = await execute(ctx, agent, 'run_operation', { plan: plan('read', {}, '') })
    expect(result, JSON.stringify(result))
      .toMatchObject({ isError: false, value: { status: 'needs-replan' } })
  })
  it('rejects malformed canonical read output', async () => {
    const { ctx, agent } = await setup(65_536, false, 'all', [action('read', 'invalid canonical read')])
    expect(await execute(ctx, agent, 'run_operation', { plan: plan('read', {}, '') })).toMatchObject({ isError: true })
  })
  it('captures actions registered by an asynchronous sibling after the selector loads', async () => {
    const { ctx, agent } = await setup(65_536, true)
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.tools.map(tool => tool.name)).toEqual(['run_operation'])
    expect(assembly.sections.find(section => section.name === 'operation:plan')!.text).toContain('"name":"probe"')
    expect(await execute(ctx, agent, 'run_operation', { plan: plan('probe', {}, '') }))
      .toMatchObject({ isError: false, value: { status: 'completed', observations: [{ value: 'loaded' }] } })
  })
  it('isolates its runner and exposes only run_operation with a complete underlying catalog', async () => {
    const { ctx, agent } = await setup()
    expect(ctx.get('operations')).toBeUndefined()
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.tools.map(tool => tool.name)).toEqual(['run_operation'])
    const catalog = assembly.sections.find(section => section.name === 'operation:plan')!.text
    for (const name of ['read', 'write', 'edit']) expect(catalog).toContain(`"name":"${name}"`)
    expect((await ctx.systemPrompt.assemble({})).tools).toEqual([])
  })
  it('returns complete selected read evidence to the planner and denies direct reads', async () => {
    const { ctx, agent } = await setup()
    expect(await execute(ctx, agent, 'read', { file_path: 'source.txt' })).toMatchObject({ isError: true })
    const result = await execute(ctx, agent, 'run_operation', { plan: plan('read', { file_path: 'source.txt', offset: 2, limit: 1 }, '/lines') })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result).toMatchObject({ isError: false, value: { status: 'completed', observations: [
      { step: 'action', pointer: '/lines', value: [{ number: 2, text: 'beta' }] },
    ] } })
  })
  it('performs literal small writes through ordinary policy and verifies the actual file', async () => {
    const { ctx, agent, root } = await setup()
    const seen: string[] = []
    ctx.on('tools/pre-execute', async (exec, next) => { seen.push(exec.name); return next() })
    const result = await execute(ctx, agent, 'run_operation', { plan: plan('write', { file_path: 'new.txt', content: 'small edit\n' }, '') })
    expect(result).toMatchObject({ isError: false, value: { status: 'completed' } })
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('small edit\n')
    expect(seen).toEqual(['run_operation', 'write'])
  })
  it('performs a literal small edit and verifies its actual replacement', async () => {
    const { ctx, agent, root } = await setup()
    expect(await execute(ctx, agent, 'run_operation', { plan: plan('edit', {
      file_path: 'source.txt', old_string: 'beta', new_string: 'delta',
    }, '') })).toMatchObject({ isError: false, value: { status: 'completed' } })
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('alpha\ndelta\ngamma\n')
  })
  it('does not grant a replacement definition the captured definition policy', async () => {
    const { ctx, agent } = await setup()
    await ctx.systemPrompt.assemble(assembleContextFor(agent))
    let ran = false
    agent.ctx.tools.register(defineTool({ name: 'read', description: 'replacement', parameters: {},
      output: { schema: { type: 'string' }, render: () => [] }, async execute() { ran = true; return 'different' } }))
    expect(await execute(ctx, agent, 'run_operation', { plan: plan('read', {}, '') })).toMatchObject({ isError: true })
    expect(ran).toBe(false)
  })
  it('rejects oversized mutations before writing', async () => {
    const { ctx, agent, root } = await setup()
    expect(await execute(ctx, agent, 'run_operation', { plan: plan('write', { file_path: 'new.txt', content: 'x'.repeat(33) }, '') }))
      .toMatchObject({ isError: true })
    await expect(readFile(join(root, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('retains ordinary mutation denial', async () => {
    const { ctx, agent, root } = await setup()
    ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'write' ? { kind: 'deny', reason: 'denied in fixture' } : next())
    expect(await execute(ctx, agent, 'run_operation', { plan: plan('write', { file_path: 'new.txt', content: 'small' }, '') }))
      .toMatchObject({ isError: true })
    await expect(readFile(join(root, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('fails a complete catalog limit without silently dropping actions', async () => {
    const { ctx, agent } = await setup(32)
    await expect(ctx.systemPrompt.assemble(assembleContextFor(agent))).rejects.toThrow('complete-byte limit')
  })
})
