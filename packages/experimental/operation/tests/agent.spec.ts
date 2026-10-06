import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
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
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import { defineTool, type ToolDefinition, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import OperationService, { type OperationConfig, type OperationJudgmentProvider } from '../src/index.ts'
import * as operationAgent from '../src/agent.ts'
import { resolveOperationPlan, resolveOperationRequest } from '../src/plan.ts'

const execFile = promisify(execFileCallback)

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
  definitions: ToolDefinition[] = [], conflictingPolicy = false, realBash = false,
  options: { config?: OperationConfig; provider?: OperationJudgmentProvider } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-operation-agent-'))
  roots.push(root)
  const preset = join(root, 'presets', 'operation')
  await mkdir(preset, { recursive: true })
  await writeFile(join(root, 'source.txt'), 'alpha\nbeta\ngamma\n')
  await writeFile(join(preset, 'agent.cordis.yml'), JSON.stringify([
    { name: 'cordis:fixture-fs', disabled: definitions.some(definition => definition.name === 'read') },
    { name: 'cordis:fixture-actions' },
    { id: 'operations', name: 'cordis:group', group: true, isolate: { operations: true, operationJudgments: true }, config: [
      { name: 'cordis:fixture-operations', config: { requireCalibration: false, returnObservations: true, ...options.config } },
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
    ctx.effect(() => ctx.operations.registerJudgmentProvider(options.provider ?? provider))
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
  if (realBash) {
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(ShellEnv, { dshHome: join(root, 'home') })
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
    await ctx.plugin(ToolBash, { enableRunInBackground: false })
  }
  await ctx.plugin(AgentPresets, { default: 'operation', roots: [{ path: join(root, 'presets'), trust: 'system' }],
    includeShippedRoot: false, includeUserRoot: false })
  const handle = await ctx.agents.create({ sessionId: SessionId('operation-profile'), meta: { cwd: root, agentPreset: 'operation' },
    setup: async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx, 'operation') } })
  return { ctx, agent: handle.agent, root, operations: operations! }
}

function plan(tool: string, args: unknown, pointer: string) {
  return { goal: 'Perform the declared action and inspect its result',
    steps: [{ tool, arguments: args, observe: [pointer] }] }
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
  it('executes the emitted one-step example through the real foreground bash tool', async () => {
    const { ctx, agent, root } = await setup(65_536, false, ['bash'], [], false, true)
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
    await execFile('git', ['init', '-b', 'fixture'], { cwd: root, env })
    await execFile('git', ['add', 'source.txt'], { cwd: root, env })
    await execFile('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Fixture initial commit'], { cwd: root, env })
    await writeFile(join(root, 'source.txt'), 'changed\n')
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    const text = assembly.sections.find(section => section.name === 'operation:plan')!.text
    const example = text.split('\n').find(line => line.startsWith('{"tool":'))!
    expect(example).toBeDefined()
    const args: unknown = JSON.parse(example)
    expect(resolveOperationRequest(args).steps).toHaveLength(1)
    const seen: string[] = []
    ctx.on('tools/pre-execute', async (exec, next) => { seen.push(exec.name); return next() })
    const result = await execute(ctx, agent, 'run_operation', args)
    expect(result, JSON.stringify(result)).toMatchObject({ isError: false, value: { status: 'completed', completedSteps: ['step-1'] } })
    const observed = (result.value as { observations: { value: { stdout: { text: string } } }[] }).observations[0]!.value.stdout.text
    expect(observed).toContain('## fixture')
    expect(observed).toContain(' M source.txt')
    expect(observed).toContain('Fixture initial commit')
    expect(seen).toEqual(['run_operation', 'bash'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/judgment-request')).toHaveLength(1)
  })
  it('executes single reads and small edits through the scoped operation pipeline', async () => {
    const { ctx, agent, root } = await setup()
    const read = await execute(ctx, agent, 'run_operation', { tool: 'read', arguments: { file_path: 'source.txt' } })
    expect(read).toMatchObject({ isError: false, value: { status: 'completed', observations: [{ value: { totalLines: 3 } }] } })
    const edit = await execute(ctx, agent, 'run_operation', { tool: 'edit', arguments: { file_path: 'source.txt', old_string: 'alpha', new_string: 'delta' } })
    expect(edit).toMatchObject({ isError: false, value: { status: 'completed' } })
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('delta\nbeta\ngamma\n')
  })
  it('rejects mixed single-action and plan requests before a write', async () => {
    const { ctx, agent, root } = await setup()
    expect(await execute(ctx, agent, 'run_operation', {
      tool: 'write', arguments: { file_path: 'source.txt', content: 'changed' }, plan: plan('read', { file_path: 'source.txt' }, ''),
    })).toMatchObject({ isError: true })
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('alpha\nbeta\ngamma\n')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/run-start')).toEqual([])
  })
  it('returns complete executed evidence exceeding the judgment budget without dispatching the next action', async () => {
    const output = { text: 'Useful evidence. '.repeat(20) }
    const { ctx, agent } = await setup(65_536, false, 'all', [action('probe', output)], false, false,
      { config: { maxObservationBytes: 64, maxReturnedObservationBytes: 1024 } })
    const result = await execute(ctx, agent, 'run_operation', { plan: {
      goal: 'Inspect evidence', steps: [{ tool: 'probe', arguments: {} }, { tool: 'probe', arguments: {} }],
    } })
    expect(result).toMatchObject({ isError: false, value: { status: 'needs-replan', completedSteps: ['step-1'],
      observations: [{ value: output }] } })
    expect(JSON.stringify(result.value)).toContain('already ran')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/step-start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/judgment-request')).toHaveLength(0)
  })
  it('preserves completed write evidence in a failed tool result when judgment preparation rejects', async () => {
    const { ctx, agent, root } = await setup(65_536, false, 'all', [], false, false, { provider: {
      ...provider, async prepare() { throw new Error('fixture decision service unavailable') },
    } })
    const result = await execute(ctx, agent, 'run_operation', { plan: {
      goal: 'Write two markers', steps: [
        { tool: 'write', arguments: { file_path: 'first.txt', content: 'written once' } },
        { tool: 'write', arguments: { file_path: 'second.txt', content: 'must not execute' } },
      ],
    } })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('Expected decision failure')
    const feedback: unknown = JSON.parse(result.error.message)
    expect(feedback).toMatchObject({ status: 'failed', completedSteps: ['step-1'], observations: [{ value: { operation: 'create', after: 'written once' } }] })
    expect(result.error.message).toContain('Do not repeat completed mutations')
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('written once')
    await expect(readFile(join(root, 'second.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/step-start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/run-end')).toMatchObject([{ data: { status: 'failed' } }])
  })
  it('never clips output that exceeds the separate planner feedback limit', async () => {
    const { ctx, agent } = await setup(65_536, false, 'all', [action('probe', { text: 'x'.repeat(500) })], false, false,
      { config: { maxReturnedObservationBytes: 64 } })
    const result = await execute(ctx, agent, 'run_operation', { tool: 'probe', arguments: {} })
    expect(result).toMatchObject({ isError: false, value: { status: 'needs-replan', completedSteps: ['step-1'], observations: [] } })
    expect(JSON.stringify(result.value)).toContain('output cannot be returned')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/judgment-request')).toHaveLength(0)
  })
  it.each(['version', 'arguments'])('rejects malformed detailed %s before operation or action effects', async (field) => {
    const { ctx, agent } = await setup()
    const raw = resolveOperationPlan(plan('write', { file_path: 'new.txt', content: 'small' }, ''))
    const malformed: Record<string, unknown> = { ...raw }
    if (field === 'version') delete malformed.version
    else malformed.steps = [{ ...raw.steps[0], arguments: { file_path: 'new.txt', content: 'small' } }]
    const seen: string[] = []
    ctx.on('tools/pre-execute', async (exec, next) => { seen.push(exec.name); return next() })
    const result = await execute(ctx, agent, 'run_operation', { plan: malformed })
    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result)).toContain(field === 'version' ? 'invalid arguments:' : 'kind must be a non-empty string')
    expect(seen).toEqual(['run_operation'])
    expect(agent.session.snapshotEvents().filter(event => event.type.startsWith('operation/'))).toEqual([])
  })
  it('omits the shell example when an admitted bash requires incompatible arguments', async () => {
    const incompatible = defineTool({ name: 'bash', description: 'Incompatible fixture action',
      parameters: { script: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: () => [] }, async execute() { return null } })
    const { ctx, agent } = await setup(65_536, false, ['bash'], [incompatible])
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.sections.find(section => section.name === 'operation:plan')!.text)
      .not.toContain('Example run_operation arguments')
  })
  it.each<ValueSchemaSpec>([
    { type: 'json' }, { type: 'object', additionalProperties: false, properties: {} },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'foreground' } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'foreground' },
      exitCode: { type: 'integer' }, stdout: { type: 'object', additionalProperties: false, properties: {} } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'foreground' },
      exitCode: { type: 'integer' }, stdout: { type: 'object', additionalProperties: false,
        properties: { text: { type: 'boolean' } } } } },
  ])('omits the shell example when the output does not declare its observed fields %j', async (schema) => {
    const incompatible = defineTool({ name: 'bash', description: 'Incompatible fixture output',
      parameters: { command: { type: 'string', required: true }, description: { type: 'string', required: true } },
      output: { schema, render: () => [] }, async execute() { throw new Error('schema-only fixture must not execute') } })
    const { ctx, agent } = await setup(65_536, false, ['bash'], [incompatible])
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.sections.find(section => section.name === 'operation:plan')!.text)
      .not.toContain('Example run_operation arguments')
  })
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
    expect(catalog).not.toContain('Example run_operation arguments')
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
  it.each([
    { exitCode: 7 }, { timedOut: true }, { aborted: true }, { signal: 'SIGTERM' },
    { sandbox: { mode: 'workspace-write', denied: true } },
    { stdout: { text: 'partial', truncated: true } },
  ])('stops a concise plan before inference or the next action on mandatory process facts %j', async (override) => {
    const { ctx, agent } = await setup(65_536, false, 'all', [action('bash', {
      kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false,
      stdout: { text: 'settled', truncated: false }, stderr: { text: '', truncated: false }, ...override,
    })])
    const seen: string[] = []
    ctx.on('tools/pre-execute', async (exec, next) => { seen.push(exec.name); return next() })
    const result = await execute(ctx, agent, 'run_operation', { plan: {
      goal: 'Inspect two settled actions', steps: [{ tool: 'bash', arguments: {} }, { tool: 'bash', arguments: {} }],
    } })
    expect(result).toMatchObject('stdout' in override
      ? { isError: false, value: { status: 'needs-replan' } } : { isError: true })
    expect(seen).toEqual(['run_operation', 'bash'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/judgment-request')).toEqual([])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/step-start')).toHaveLength(1)
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
      { step: 'step-1', pointer: '/lines', value: [{ number: 2, text: 'beta' }] },
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
