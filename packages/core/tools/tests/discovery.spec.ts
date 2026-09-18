import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { CodeRuntime, type CodeRunRequest, type CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type Config, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDiscovery, type ToolDiscoveryConfig } from '../src/discovery.ts'

const discovery: ToolDiscoveryConfig = { prefixes: ['special_'], defaultLimit: 2, maxLimit: 4, maxQueryBytes: 128, maxResultBytes: 256 }
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

class Runtime extends CodeRuntime {
  readonly language: string
  readonly isolation = 'fixture'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })
  constructor(ctx: Context, config: { language: string }) { super(ctx); this.language = config.language }
  run(request: CodeRunRequest): Promise<CodeRunResult> { return this.behavior(request) }
}

async function setup(config: Config = { discovery }, language = 'typescript') {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, config)
  await ctx.plugin(Runtime, { language })
  return ctx
}

async function agentScope(ctx: Context, session = Session.create(SessionId('discovery'))) {
  const agent = { id: session.id, session } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] }))
  return { agent, scope }
}

function register(ctx: Context, name: string, description = 'Search project documents') {
  return ctx.tools.register(defineTool({
    name, description, parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: () => Promise.resolve(name),
  }))
}

function settle(agent: Agent, name: string, callId: ReturnType<typeof ToolCallId>, result: ToolExecutionResult) {
  agent.session.append('tool/call', { turn: 1, step: 1, name, callId, arguments: '{}' })
  agent.session.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
  }, { surfaceOp: 'append' })
}

async function run(ctx: Context, agent: Agent, name: string, args: unknown = {}, commit = true) {
  const callId = ToolCallId(`call-${agent.session.seq}`)
  const result = await ctx.tools.execute({ name, arguments: args, callId, agent, signal: new AbortController().signal })
  if (commit) settle(agent, name, callId, result)
  return result
}

async function names(ctx: Context, agent: Agent) {
  return (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(tool => tool.name)
}

describe('deferred tool presentation', () => {
  it('keeps existing configurations eager and does not register discovery', async () => {
    const ctx = await setup({})
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_documents')
    expect(await names(ctx, agent)).toEqual(['special_documents'])
  })

  it('admits a tool only after a successful search settlement and rejects premature execution', async () => {
    const ctx = await setup()
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_documents')
    register(ctx, 'read', 'Read files')
    expect(await names(ctx, agent)).toEqual(['read', 'tool_search'])
    expect((await run(ctx, agent, 'special_documents')).isError).toBe(true)
    const result = await run(ctx, agent, 'tool_search', { query: 'documents' }, false)
    expect(result).toMatchObject({ isError: false, value: { tools: ['special_documents'], truncated: false } })
    expect(await names(ctx, agent)).toEqual(['read', 'tool_search'])
    settle(agent, 'tool_search', ToolCallId('discovered'), result)
    expect(await names(ctx, agent)).toEqual(['read', 'special_documents', 'tool_search'])
    expect((await run(ctx, agent, 'special_documents')).isError).toBe(false)
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toContain('special_documents')
  })

  it('keeps searches within permissions, isolates sessions, and applies restrictions after admission', async () => {
    const ctx = await setup()
    const { agent, scope } = await agentScope(ctx)
    const other = await agentScope(ctx, Session.create(SessionId('other')))
    register(ctx, 'special_documents')
    register(ctx, 'special_secrets', 'Search secret documents')
    scope.ctx.tools.restrict({ deny: ['special_secrets'] })
    expect(await run(ctx, agent, 'tool_search', { query: 'documents' })).toMatchObject({ value: { tools: ['special_documents'] } })
    expect(await names(ctx, other.agent)).toEqual(['tool_search'])
    scope.ctx.tools.restrict({ deny: ['special_documents'] })
    expect((await run(ctx, agent, 'special_documents')).isError).toBe(true)
    expect(await names(ctx, agent)).toEqual(['tool_search'])
  })

  it('drops unregistered tools and restores admissions from copied session events', async () => {
    const ctx = await setup()
    const { agent } = await agentScope(ctx)
    const dispose = register(ctx, 'special_documents')
    await run(ctx, agent, 'tool_search', { query: 'documents' })
    const restored = await agentScope(ctx, Session.create(SessionId('restored'), agent.session.snapshotEvents()))
    expect(await names(ctx, restored.agent)).toContain('special_documents')
    dispose()
    expect(await names(ctx, restored.agent)).toEqual(['tool_search'])
    expect((await run(ctx, restored.agent, 'special_documents')).isError).toBe(true)
  })

  it('ignores failed, unrelated, or malformed search results', async () => {
    const ctx = await setup()
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_documents')
    const success = await run(ctx, agent, 'tool_search', { query: 'documents' }, false)
    settle(agent, 'unrelated', ToolCallId('unrelated'), success)
    settle(agent, 'tool_search', ToolCallId('failed'), { isError: true, content: success.content, error: { message: 'failed' } })
    for (const [index, text] of ['no JSON', 'null', '[]', '{}', '{"tools":[1],"truncated":false}', '{"tools":["special_documents"],"truncated":false,"extra":true}'].entries()) {
      settle(agent, 'tool_search', ToolCallId(`malformed-${index}`), { isError: false, content: [{ type: 'text', text }], value: null })
    }
    settle(agent, 'tool_search', ToolCallId('empty'), { isError: false, content: [], value: null })
    expect(await names(ctx, agent)).toEqual(['tool_search'])
  })

  it('does not admit cancelled or policy-blocked searches', async () => {
    const ctx = await setup()
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_documents')
    const controller = new AbortController()
    controller.abort()
    const aborted = await ctx.tools.execute({ name: 'tool_search', arguments: { query: 'documents' }, callId: ToolCallId('abort'), agent, signal: controller.signal })
    expect(aborted.isError).toBe(true)
    const dispose = ctx.on('tools/post-execute', () => Promise.resolve({ kind: 'block', feedback: [{ type: 'text', text: 'blocked' }] }))
    expect((await run(ctx, agent, 'tool_search', { query: 'documents' })).isError).toBe(true)
    dispose()
    expect(await names(ctx, agent)).toEqual(['tool_search'])
  })

  it('bounds count, complete result bytes, and multibyte queries', async () => {
    const ctx = await setup({ discovery: { ...discovery, maxResultBytes: 48, maxQueryBytes: 8 } })
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_a', 'documents')
    register(ctx, 'special_b', 'documents')
    const limited = await run(ctx, agent, 'tool_search', { query: 'special', limit: 1 })
    expect(limited).toMatchObject({ value: { tools: ['special_a'], truncated: true } })
    const bounded = await run(ctx, agent, 'tool_search', { query: 'special' })
    expect(bounded).toMatchObject({ value: { tools: ['special_a'], truncated: true } })
    expect(Buffer.byteLength(JSON.stringify(bounded.isError ? null : bounded.value))).toBeLessThanOrEqual(48)
    expect((await run(ctx, agent, 'tool_search', { query: '界界界' })).isError).toBe(true)
    expect((await run(ctx, agent, 'tool_search', { query: ' ' })).isError).toBe(true)
    for (const limit of [0, 5, 1.5]) expect((await run(ctx, agent, 'tool_search', { query: 'special', limit })).isError).toBe(true)
    expect(await run(ctx, agent, 'tool_search', { query: 'absent' })).toMatchObject({ value: { tools: [], truncated: false } })
    expect((await ctx.tools.execute({ name: 'tool_search', arguments: { query: 'special' }, callId: ToolCallId('agentless'), signal: new AbortController().signal })).isError).toBe(true)
    expect((await ctx.tools.execute({ name: 'special_a', arguments: {}, callId: ToolCallId('agentless-hidden'), signal: new AbortController().signal })).isError).toBe(true)
  })

  it('ranks lexical matches and breaks equal scores by name regardless of registration order', async () => {
    const ctx = await setup()
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_z', 'mango')
    register(ctx, 'special_a', 'apple')
    expect(await run(ctx, agent, 'tool_search', { query: 'mango apple' })).toMatchObject({ value: { tools: ['special_a', 'special_z'] } })
    expect(await run(ctx, agent, 'tool_search', { query: 'mango' })).toMatchObject({ value: { tools: ['special_z'] } })
  })

  it('keeps native schemas, program SDKs, and execution policy aligned in both mode', async () => {
    const ctx = await setup({ discovery, mode: 'both' })
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_documents')
    expect(await names(ctx, agent)).toEqual(['run_code', 'tool_search'])
    await run(ctx, agent, 'tool_search', { query: 'documents' })
    const prompt = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(prompt.tools.map(tool => tool.name)).toEqual(['run_code', 'special_documents', 'tool_search'])
    expect(prompt.sections.find(section => section.name === 'tools:sdk')?.text).toContain('special_documents')
    ctx.tools.guard(() => 'deployment denies this operation')
    expect(await run(ctx, agent, 'special_documents')).toMatchObject({ isError: true, error: { message: 'deployment denies this operation' } })
  })

  it.each(['typescript', 'python'])('keeps %s SDKs and program bindings aligned with durable discovery', async (language) => {
    const ctx = await setup({ discovery, mode: 'ptc' }, language)
    const { agent } = await agentScope(ctx)
    register(ctx, 'special_documents')
    const before = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(before.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(before.sections.find(section => section.name === 'tools:sdk')?.text).not.toContain('special_documents')
    const runtime = ctx.codeRuntime as Runtime
    runtime.behavior = async (request) => {
      const functions = request.bindings[0]!.functions
      expect(Object.keys(functions)).toEqual(['tool_search'])
      const value = await functions.tool_search!({ query: 'documents' })
      return { logs: [], value }
    }
    expect((await run(ctx, agent, 'run_code', { code: 'discovery fixture', description: 'Find tools' })).isError).toBe(false)
    const after = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(after.sections.find(section => section.name === 'tools:sdk')?.text).toContain('special_documents')
    runtime.behavior = async request => ({ logs: [], value: await request.bindings[0]!.functions.special_documents!({}) })
    expect((await run(ctx, agent, 'run_code', { code: 'use fixture', description: 'Use discovered tool' })).isError).toBe(false)
    expect((await run(ctx, agent, 'special_documents')).isError).toBe(true)
  })

  it('reserves the discovery name and removes it with the registry lifetime', async () => {
    const ctx = await setup()
    expect(() => register(ctx, 'tool_search')).toThrow('reserved')
    await ctx.fiber.dispose()
    expect(ctx.get('tools')).toBeUndefined()
  })
})

describe('discovery configuration', () => {
  it('validates optional activation and all required bounds', () => {
    expect(resolveDiscovery(undefined)).toBeUndefined()
    expect(ToolRuntime.Config({}).discovery).toBeUndefined()
    // @ts-expect-error Loader input must reject an incomplete discovery configuration.
    expect(() => ToolRuntime.Config({ discovery: {} })).toThrow()
    for (const patch of [
      { prefixes: [] }, { prefixes: [''] }, { prefixes: ['special_', 'special_'] },
      { prefixes: ['tool_'] }, { prefixes: ['run_'] }, { defaultLimit: 5 }, { maxResultBytes: 1 },
      ...['defaultLimit', 'maxLimit', 'maxQueryBytes', 'maxResultBytes'].map(key => ({ [key]: 0 })),
    ]) expect(() => resolveDiscovery({ ...discovery, ...patch })).toThrow()
  })
})
