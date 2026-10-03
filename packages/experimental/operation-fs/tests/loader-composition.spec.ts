import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type Config as ToolsConfig } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import OperationService, { replayOperation, type OperationJudgmentProvider } from '@deepseek-ai/dsh-experimental-operation'
import * as operationFs from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { configFor } from './config.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const identity = {
  provider: 'deterministic-test', model: 'no-inference', encoder: 'fixture', tokenizer: 'fixture', serialization: 'fixture',
  deployment: 'deterministic-fixture', deploymentManifest: { reference: 'test-only', digest: 'test-only' },
} as const

const provider: OperationJudgmentProvider = {
  identity,
  async prepare(draft) { return { draft, wire: { id: draft.id }, inputTokens: 1, identity } },
  async rank(prepared) {
    const candidate = prepared.draft.candidates.find(candidate => candidate.kind === 'continue' || candidate.kind === 'complete')
    if (candidate === undefined) throw new Error('test expected an autonomous choice')
    return {
      requestId: prepared.draft.id, identity,
      probabilities: Object.fromEntries(prepared.draft.candidates.map(item => [item.id, item === candidate ? 1 : 0])),
      usage: { inputTokens: 1, outputTokens: 0 },
    }
  },
}

async function load(options: { tools?: ToolsConfig; config?: Partial<Config> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-operation-fs-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'a.ts'), 'alpha source\n')
  await writeFile(join(workspace, 'src', 'b.ts'), 'beta source\n')
  const config = configFor(workspace)
  Object.assign(config, options.config)
  const configPath = join(root, 'cordis.yml')
  const rows = [
    { name: '@deepseek-ai/dsh-llm' },
    { name: '@deepseek-ai/dsh-session' },
    { name: '@deepseek-ai/dsh-session-projection' },
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools', config: options.tools ?? {} },
    { name: '@deepseek-ai/dsh-agent' },
    { name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions') } },
    { name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
    { name: '@deepseek-ai/dsh-fs-local', config: { cwd: root } },
    { name: '@deepseek-ai/dsh-subprocess-local' },
    { name: '@deepseek-ai/dsh-experimental-operation', config: { requireCalibration: false } },
    { name: '@deepseek-ai/dsh-experimental-operation-fs', config },
    { name: 'test:deterministic-judgment' },
  ]
  // JSON is a YAML subset; this file is parsed by the real Include and Loader.
  await writeFile(configPath, JSON.stringify(rows))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  expect('default' in operationFs).toBe(false)
  expect(ctx.loader.unwrapExports(operationFs)).toMatchObject({
    name: operationFs.name, inject: operationFs.inject, apply: operationFs.apply, Config: operationFs.Config,
  })
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime], ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence], ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem], ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-experimental-operation', OperationService], ['@deepseek-ai/dsh-experimental-operation-fs', operationFs],
    ['test:deterministic-judgment', {
      inject: ['operations'],
      apply(ctx: Context) { ctx.effect(() => ctx.operations.registerJudgmentProvider(provider)) },
    }],
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
  const agent = await ctx.agentLoop.create(SessionId('fs-operations'), {}, { cwd: workspace })
  return { ctx, agent, root, workspace, config }
}

function readPlan(path = 'src/a.ts', limit = 20) {
  return {
    version: 1, name: 'whole-read', goal: 'inspect whole source', inputs: {},
    steps: [{
      id: 'read', tool: 'read', purpose: 'inspect source', arguments: { kind: 'literal', value: { file_path: path, limit } },
      assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/lines' } }],
      observation: { paths: ['/lines'] }, question: 'Is the source complete?',
    }],
    completion: {
      assertions: [{ kind: 'present', value: { kind: 'result', step: 'read', pointer: '/lines' } }],
      evidence: [{ kind: 'result', step: 'read', pointer: '/lines' }], question: 'Complete?',
    },
  }
}

function selectionPlan(path = 'src', pattern = '*.ts') {
  const read = readPlan()
  return {
    ...read,
    steps: [{
      id: 'glob', tool: 'glob', purpose: 'locate source', arguments: { kind: 'literal', value: { pattern, path } },
      assertions: [{ kind: 'present', value: { kind: 'result', step: 'glob', pointer: '/paths' } }],
      observation: { paths: ['/paths'], candidates: '/paths' }, question: 'Which file?',
    }, {
      ...read.steps[0],
      arguments: { kind: 'object', properties: { file_path: { kind: 'selected', step: 'glob', pointer: '' }, limit: { kind: 'literal', value: 20 } } },
    }],
  }
}

async function execute(ctx: Context, agent: Agent, name: string, args: unknown) {
  return await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    name, arguments: args, agent, callId: ToolCallId(`${name}-${agent.session.seq}`), signal: new AbortController().signal,
  }))
}

async function run(ctx: Context, agent: Agent, plan: unknown) {
  return await execute(ctx, agent, 'run_operation', { plan })
}

describe('real Loader read-only operation composition', () => {
  it('preserves complete canonical glob paths across display caps and selects an unchanged root-qualified read path', async () => {
    const { ctx, agent, workspace } = await load()
    const result = await run(ctx, agent, selectionPlan())
    expect(result).toMatchObject({ isError: false, value: { status: 'completed', completedSteps: ['glob', 'read'] } })
    const events = agent.session.snapshotEvents()
    const search = events.find(event => event.type === 'operation/step-result' && event.data.stepId === 'glob')
    expect(search?.data).toHaveProperty('value.root', 'src')
    expect(search?.data).toHaveProperty('value.paths', expect.arrayContaining([join('src', 'a.ts'), join('src', 'b.ts')]))
    expect(JSON.stringify(search?.data)).toContain('Showing 1 of 2 paths')
    const read = events.find(event => event.type === 'operation/step-start' && event.data.stepId === 'read')
    expect(read?.data).toHaveProperty('arguments.limit', 20)
    expect(read?.data).toHaveProperty('arguments.file_path', expect.stringMatching(/^src[/\\][ab]\.ts$/))
    expect(replayOperation(events).status).toBe('completed')
    expect(await readFile(join(workspace, 'src/a.ts'), 'utf8')).toBe('alpha source\n')
    expect(await readFile(join(workspace, 'src/b.ts'), 'utf8')).toBe('beta source\n')
    const schemas = (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(tool => tool.name)
    expect(schemas).toEqual(expect.arrayContaining(['read', 'glob', 'grep', 'run_operation']))
    for (const excluded of ['bash', 'write', 'edit', 'read_image', 'web_fetch', 'browser', 'subagent', 'job_output']) expect(schemas).not.toContain(excluded)
  })

  it.skipIf(process.platform === 'win32')('rejects invalid-byte glob paths before selection can read a replacement-character alias', async () => {
    const { ctx, agent, workspace } = await load()
    const invalid = Buffer.concat([Buffer.from(join(workspace, 'src/bad')), Buffer.from([0xff]), Buffer.from('.ts')])
    await writeFile(invalid, 'invalid-byte filename source\n')
    await writeFile(join(workspace, 'src/bad\ufffd.ts'), 'different valid filename source\n')
    const body = vi.spyOn(ctx.fs, 'readText')
    expect(await run(ctx, agent, selectionPlan('src', 'bad*.ts'))).toMatchObject({ isError: true })
    const events = agent.session.snapshotEvents()
    const result = events.find(event => event.type === 'operation/step-result')
    expect(result?.data).toMatchObject({ isError: true, error: { code: 'SEARCH_FAILED' } })
    expect(events.filter(event => event.type === 'operation/judgment-request')).toHaveLength(0)
    expect(events.filter(event => event.type === 'operation/step-start' && event.data.stepId === 'read')).toHaveLength(0)
    expect(body).not.toHaveBeenCalled()
    expect(replayOperation(events).status).toBe('failed')
  })

  it('rejects a malformed-Unicode glob pattern before it can select a replacement-character filename', async () => {
    const { ctx, agent, workspace } = await load()
    await writeFile(join(workspace, 'bad\ufffd.ts'), 'different valid filename source\n')
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    const body = vi.spyOn(ctx.fs, 'readText')
    expect(await run(ctx, agent, selectionPlan('.', 'bad\ud800.ts'))).toMatchObject({ isError: true })
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'operation/step-start')).toHaveLength(0)
    expect(events.filter(event => event.type === 'operation/judgment-request')).toHaveLength(0)
    expect(spawn).not.toHaveBeenCalled()
    expect(body).not.toHaveBeenCalled()
  })

  it.each(['bad\ufffd.ts', '\ufeffbom.ts', '-'])('binds selection and read to the real valid path %j', async (filename) => {
    const { ctx, agent, workspace } = await load()
    await writeFile(join(workspace, filename), 'intended exact source\n')
    expect(await run(ctx, agent, selectionPlan(filename, '*'))).toMatchObject({
      isError: false, value: { status: 'completed', completedSteps: ['glob', 'read'] },
    })
    const events = agent.session.snapshotEvents()
    const target = filename === '-' ? './-' : filename
    const search = events.find(event => event.type === 'operation/step-result' && event.data.stepId === 'glob')
    expect(search?.data).toMatchObject({ value: { root: filename, paths: [target] } })
    const read = events.find(event => event.type === 'operation/step-start' && event.data.stepId === 'read')
    expect(read?.data).toHaveProperty('arguments.file_path', target)
    const result = events.find(event => event.type === 'operation/step-result' && event.data.stepId === 'read')
    expect(result?.data).toMatchObject({ value: { lines: [{ number: 1, text: 'intended exact source' }] } })
  })

  it('does not complete an empty-search claim when the approved bare-dash file has a match', async () => {
    const { ctx, agent, workspace } = await load()
    await writeFile(join(workspace, '-'), 'needle in the approved file\n')
    const evidence = { kind: 'result', step: 'search', pointer: '/matches' }
    const assertions = [{ kind: 'equals', left: evidence, right: { kind: 'literal', value: [] } }]
    const plan = {
      version: 1, name: 'dash-search', goal: 'verify absence in the approved file', inputs: {},
      steps: [{
        id: 'search', tool: 'grep', purpose: 'search approved file',
        arguments: { kind: 'literal', value: { pattern: 'needle', path: '-' } },
        assertions, observation: { paths: ['/matches'] }, question: 'No matches?',
      }],
      completion: { assertions, evidence: [evidence], question: 'Absence verified?' },
    }
    expect(await run(ctx, agent, plan)).toMatchObject({ isError: false, value: { status: 'stopped' } })
    const events = agent.session.snapshotEvents()
    const result = events.find(event => event.type === 'operation/step-result')
    expect(result?.data).toMatchObject({
      isError: false, value: { matches: [{ path: './-', lineNumber: 1, line: 'needle in the approved file' }] },
    })
    expect(events.filter(event => event.type === 'operation/judgment-request')).toHaveLength(0)
    expect(replayOperation(events).status).toBe('stopped')
  })

  it('uses each actual session cwd instead of the filesystem provider default', async () => {
    const { ctx, agent, workspace } = await load()
    const nested = join(workspace, 'nested')
    await mkdir(join(nested, 'src'), { recursive: true })
    await writeFile(join(nested, 'src/a.ts'), 'other session\n')
    const other = await ctx.agentLoop.create(SessionId('other-caller'), {}, { cwd: nested })
    for (const [caller, text] of [[agent, 'alpha source'], [other, 'other session']] as const) {
      expect(await run(ctx, caller, readPlan())).toMatchObject({ isError: false, value: { status: 'completed' } })
      const result = caller.session.snapshotEvents().find(event => event.type === 'operation/step-result')
      expect(result?.data).toMatchObject({ value: { lines: [{ number: 1, text }] } })
    }
  })

  it('returns replan for partial or clipped reads and uses post-policy canonical values, not rendered text', async () => {
    const { ctx, agent, workspace } = await load({ config: { readMaxLineLength: 4 } })
    expect(await run(ctx, agent, readPlan())).toMatchObject({ isError: false, value: { status: 'needs-replan' } })
    await writeFile(join(workspace, 'src/a.ts'), 'a\nb\n')
    expect(await run(ctx, agent, readPlan('src/a.ts', 1))).toMatchObject({ isError: false, value: { status: 'needs-replan' } })
    const misleading = ctx.on('tools/post-execute', async (exec, _result, next) => exec.name === 'read'
      ? { kind: 'accept', content: [{ type: 'text', text: 'all complete' }] }
      : next())
    expect(await run(ctx, agent, readPlan('src/a.ts', 1))).toMatchObject({ isError: false, value: { status: 'needs-replan' } })
    misleading()
    ctx.on('tools/post-execute', async (exec, _result, next) => exec.name === 'read'
      ? { kind: 'accept', value: { path: 'src/a.ts', offset: 1, totalLines: 2, lines: [{ number: 1, text: 'a' }], truncatedByBytes: false, truncatedLineNumbers: [] } }
      : next())
    expect(await run(ctx, agent, readPlan())).toMatchObject({ isError: false, value: { status: 'needs-replan' } })
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/judgment-request')).toHaveLength(0)
  })

  it('accepts empty whole files and empty search collections without inventing goal satisfaction', async () => {
    const { ctx, agent, workspace } = await load()
    await writeFile(join(workspace, 'src/a.ts'), '')
    expect(await run(ctx, agent, readPlan())).toMatchObject({ isError: false, value: { status: 'completed' } })
    const result = agent.session.snapshotEvents().find(event => event.type === 'operation/step-result')
    expect(result?.data).toMatchObject({ value: { lines: [], totalLines: 0, truncatedByBytes: false, truncatedLineNumbers: [] } })
    expect(await execute(ctx, agent, 'glob', { pattern: '*.missing', path: 'src' })).toMatchObject({ value: { paths: [] } })
    expect(await execute(ctx, agent, 'grep', { pattern: 'absent-text', path: 'src' })).toMatchObject({ value: { matches: [] } })
  })

  it('rejects malformed post-policy canonical values through the ordinary output schema', async () => {
    const { ctx, agent } = await load()
    ctx.on('tools/post-execute', async (exec, _result, next) => exec.name === 'read'
      ? { kind: 'accept', value: { path: 'src/a.ts', offset: 1, totalLines: 0, lines: [] } }
      : next())
    expect(await run(ctx, agent, readPlan())).toMatchObject({ isError: true })
    const result = agent.session.snapshotEvents().find(event => event.type === 'operation/step-result')
    expect(result?.data).toMatchObject({ isError: true, error: { code: 'INVALID_TOOL_OUTPUT' } })
    expect(agent.session.snapshotEvents().filter(event => event.type === 'operation/judgment-request')).toHaveLength(0)
  })

  it('keeps successful grep evidence complete before line and match presentation caps', async () => {
    const { ctx, agent } = await load()
    const result = await execute(ctx, agent, 'grep', { pattern: 'source', path: 'src' })
    expect(result.isError).toBe(false)
    expect(result).toHaveProperty('value.matches', expect.arrayContaining([
      { path: join('src', 'a.ts'), lineNumber: 1, line: 'alpha source' },
      { path: join('src', 'b.ts'), lineNumber: 1, line: 'beta source' },
    ]))
    expect(JSON.stringify(result.content)).toContain('Found 1 of 2 matches')
    const definition = ctx.tools.get('grep')!
    if (result.isError) throw new Error('grep failed')
    expect(ctx.operations.toolPolicies.require(definition).inspectResult(result.value)).toEqual({ kind: 'complete' })
  })

  it('does not grant discovery, scoped visibility, or ordinary policy permission', async () => {
    const { ctx, agent } = await load({ tools: { discovery: { prefixes: ['read', 'glob', 'grep'], defaultLimit: 10, maxLimit: 10, maxQueryBytes: 100, maxResultBytes: 4096 } } })
    const body = vi.spyOn(ctx.fs, 'readText')
    expect(await run(ctx, agent, readPlan())).toMatchObject({ isError: true })
    expect(body).not.toHaveBeenCalled()
    const found = await execute(ctx, agent, 'tool_search', { query: 'read' })
    expect(found.isError).toBe(false)
    const callId = ToolCallId('discovered-read')
    agent.session.append('tool/call', { turn: 1, step: 1, name: 'tool_search', callId, arguments: '{"query":"read"}' })
    agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: found.content, isError: found.isError }) }, { surfaceOp: 'append' })
    const deny = ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'read' ? { kind: 'deny', reason: 'ordinary permission denied' } : next())
    expect(await run(ctx, agent, readPlan())).toHaveProperty('error.message', expect.stringContaining('ordinary permission denied'))
    expect(body).not.toHaveBeenCalled()
    deny()
    expect(await run(ctx, agent, readPlan())).toMatchObject({ isError: false })
    body.mockClear()
    agent.ctx.tools.restrict({ deny: ['read'] })
    expect(await run(ctx, agent, readPlan())).toMatchObject({ isError: true })
    expect(body).not.toHaveBeenCalled()
  })

  it('rejects provider cwd drift after approval before any read body effect', async () => {
    const { ctx, agent, root } = await load()
    const body = vi.spyOn(ctx.fs, 'readText')
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === 'read') {
        await Promise.resolve()
        vi.spyOn(ctx.subprocess, 'resolveWorkingDirectory').mockReturnValue(root)
      }
      return next()
    })
    expect(await run(ctx, agent, readPlan())).toHaveProperty('error.message', expect.stringContaining('working-directory mapping'))
    expect(body).not.toHaveBeenCalled()
    expect(replayOperation(agent.session.snapshotEvents())).toMatchObject({ status: 'failed', steps: [{ dispatch: 'not-started' }] })
  })

  it('rejects unknown operation args and preserves ordinary read argument behavior', async () => {
    const { ctx, agent } = await load()
    const body = vi.spyOn(ctx.fs, 'readText')
    const plan = readPlan()
    Object.assign(plan.steps[0]!.arguments.value, { cwd: '/model-chosen' })
    expect(await run(ctx, agent, plan)).toMatchObject({ isError: true })
    expect(body).not.toHaveBeenCalled()
    expect(await execute(ctx, agent, 'read', { file_path: 'src/a.ts' })).toMatchObject({ isError: false })
  })

  it('owns exact definition eligibility through HMR and rejects duplicate or scoped mounts', async () => {
    const { ctx, agent, config } = await load()
    const definitions = ['read', 'glob', 'grep'].map(name => ctx.tools.get(name)!)
    await expect(ctx.plugin({ ...operationFs, name: 'duplicate-operation-fs' }, config)).rejects.toThrow()
    for (const definition of definitions) expect(ctx.tools.get(definition.name)).toBe(definition)
    await expect(agent.ctx.plugin({ ...operationFs, name: 'scoped-operation-fs' }, config)).rejects.toThrow('global scope')
    const entry = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-operation-fs')!
    await entry.fiber!.dispose()
    for (const definition of definitions) {
      expect(ctx.tools.get(definition.name)).toBeUndefined()
      expect(() => ctx.operations.toolPolicies.require(definition)).toThrow('no trusted operation policy')
    }
    const prompt = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(JSON.stringify(prompt)).not.toContain('Use the read tool')
    await ctx.plugin(operationFs, config)
    for (const definition of definitions) {
      const next = ctx.tools.get(definition.name)!
      expect(next).not.toBe(definition)
      expect(() => ctx.operations.toolPolicies.require(next)).not.toThrow()
      expect(() => ctx.operations.toolPolicies.require(definition)).toThrow()
    }
  })
})
