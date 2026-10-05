import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  const effects: string[] = []
  ctx.tools.register(defineTool({
    name: 'read', description: 'Read fixture', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { effects.push('read'); return 'evidence' },
  }))
  ctx.tools.register(defineTool({
    name: 'run_operation', description: 'Delegate fixture', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('fixture requires its scoped agent')
      const result = await ctx.tools.execute({ name: 'read', arguments: {}, agent: exec.agent,
        callId: ToolCallId('nested-read'), rootCallId: exec.rootCallId, parent: exec.token, signal: exec.signal })
      if (result.isError) throw result.error
      if (typeof result.value !== 'string') throw new Error('fixture reader requires string evidence')
      return result.value
    },
  }))
  const agent = { id: SessionId('operation-model') } as Agent
  let scoped!: Context
  await ctx.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, agent).ctx },
    { inject: ['tools', 'systemPrompt'] }))
  const dispose = scoped.tools.presentAs('operation')
  const call = (name: string) => ctx.tools.execute({ name, arguments: {}, agent,
    callId: ToolCallId(`call-${name}`), signal: new AbortController().signal })
  return { ctx, scoped, agent, effects, dispose, call }
}

describe('operation-only tool presentation', () => {
  it('exposes only run_operation without requiring a code runtime', async () => {
    const { ctx, agent } = await setup()
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['run_operation'])
    expect(assembly.sections.find(section => section.name === 'tools:ptc-only')?.text).toContain('Direct calls to other tools are rejected')
    expect(assembly.sections.find(section => section.name === 'tools:sdk')?.text).toBe('')
    expect(ctx.tools.get('run_code', agent)).toBeUndefined()
  })

  it('rejects direct underlying calls before approval listeners and effects', async () => {
    const { ctx, effects, call } = await setup()
    const policy: string[] = []
    ctx.on('tools/pre-execute', async (exec, next) => { policy.push(exec.name); return next() })
    const result = await call('read')
    expect(result.isError).toBe(true)
    expect(effects).toEqual([])
    expect(policy).toEqual([])
  })

  it('allows operation-owned nested calls through normal policy', async () => {
    const { ctx, effects, call } = await setup()
    const policy: string[] = []
    ctx.on('tools/pre-execute', async (exec, next) => { policy.push(exec.name); return next() })
    const result = await call('run_operation')
    expect(result.isError).toBe(false)
    expect(result.value).toBe('evidence')
    expect(effects).toEqual(['read'])
    expect(policy).toEqual(['run_operation', 'read'])
  })

  it('preserves ordinary nested denial', async () => {
    const { ctx, effects, call } = await setup()
    ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'read'
      ? { kind: 'deny', reason: 'fixture policy denied read' } : next())
    expect((await call('run_operation')).isError).toBe(true)
    expect(effects).toEqual([])
  })

  it('keeps native scopes separate and restores direct execution on disposal', async () => {
    const { ctx, dispose, effects, call } = await setup()
    expect((await ctx.systemPrompt.assemble({})).tools.map(tool => tool.name)).toEqual(['read', 'run_operation'])
    dispose()
    expect((await call('read')).isError).toBe(false)
    expect(effects).toEqual(['read'])
  })

  it('fails assembly when its entrypoint is unavailable', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, { mode: 'operation' })
    await expect(ctx.systemPrompt.assemble({})).rejects.toThrow('requires a visible, admitted run_operation')
  })
})
