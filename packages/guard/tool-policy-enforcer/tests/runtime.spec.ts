import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolPolicyService, { ToolPolicyProviderId, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import { apply, Config, shouldEnforce } from '../src/index.ts'

function fakeAgent() {
  const events: Array<Record<string, unknown>> = [{ type: 'turn/start', data: { turn: 1 } }]
  const session = {
    id: 'session', events,
    append(type: string, data: unknown) { const event = { type, data }; events.push(event); return event },
  }
  return { agent: { session } as unknown as Agent, events }
}

describe('tool-policy enforcement through ToolRuntime', () => {
  it('accepts an omitted activation condition but rejects explicit empty lists', () => {
    expect(Config({})).toEqual({})
    expect(() => Config({ enforceWhen: { sandboxModes: [] } }))
      .toThrow(/sandboxModes/)
    expect(() => Config({ enforceWhen: { approvalPolicies: [] } }))
      .toThrow(/approvalPolicies/)
  })

  it('matches configured durable permission values and keeps enforcement when they are absent', () => {
    const condition = { sandboxModes: ['danger-full-access'], approvalPolicies: ['ask'] } as const
    const events = (sandbox: string, approval: string): SessionEvent[] => [
      { type: 'sandbox/mode', data: { mode: sandbox } },
      { type: 'approval/policy', data: { policy: approval } },
    ] as SessionEvent[]

    expect(shouldEnforce([], undefined)).toBe(true)
    expect(shouldEnforce([], condition)).toBe(true)
    expect(shouldEnforce(events('danger-full-access', 'ask').slice(0, 1), condition)).toBe(true)
    expect(shouldEnforce(events('danger-full-access', 'ask').slice(1), condition)).toBe(true)
    expect(shouldEnforce(events('workspace-write', 'ask'), condition)).toBe(false)
    expect(shouldEnforce(events('danger-full-access', 'ask'), condition)).toBe(true)
    expect(shouldEnforce(events('danger-full-access', 'never'), condition)).toBe(false)
  })

  it('delegates allow and enters approval on the first ask while denials remain non-approvable', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolPolicyService, {})
    let current: ToolPolicyVerdict | undefined
    ctx.toolPolicy.register(ToolPolicyProviderId('fake'), { evaluate: async () => current })
    apply(ctx)
    const prompted = vi.fn()
    ctx.on('approval/request', () => {
      prompted()
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    let executions = 0
    ctx.tools.register(defineTool({
      name: 'probe', description: 'probe', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { executions += 1; return 'ran' },
    }))
    const { agent, events } = fakeAgent()
    const execute = (id: string) => ctx.tools.execute({
      callId: CallId(id), name: 'probe', arguments: { stable: true }, agent,
      signal: new AbortController().signal,
    })

    await expect(execute('unsupported')).resolves.toMatchObject({ isError: false })
    current = { providerId: ToolPolicyProviderId('fake'), decision: 'allow', risk: 0, categories: [], reason: 'safe', opinions: [] }
    await expect(execute('allow')).resolves.toMatchObject({ isError: false })
    current = { providerId: ToolPolicyProviderId('fake'), decision: 'deny', risk: 90, categories: [], reason: 'blocked', opinions: [] }
    await expect(execute('deny')).resolves.toMatchObject({ isError: true, content: [{ text: 'Error: blocked' }] })
    expect(prompted).not.toHaveBeenCalled()
    current = { providerId: ToolPolicyProviderId('fake'), decision: 'ask', risk: 60, categories: [], reason: 'review', opinions: [] }
    await expect(execute('ask')).resolves.toMatchObject({ isError: false })
    expect(prompted).toHaveBeenCalledOnce()
    expect(executions).toBe(3)
    expect(events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    expect(events.filter(event => event.type === 'approval/decided')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool-policy/decision')).toHaveLength(6)
  })

  it('bypasses providers outside configured permission values', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolPolicyService, {})
    const evaluate = vi.fn(async (): Promise<ToolPolicyVerdict> => ({
      providerId: ToolPolicyProviderId('fake'), decision: 'deny', risk: 90,
      categories: [], reason: 'blocked', opinions: [],
    }))
    ctx.toolPolicy.register(ToolPolicyProviderId('fake'), { evaluate })
    apply(ctx, { enforceWhen: { sandboxModes: ['danger-full-access'], approvalPolicies: ['ask'] } })
    let executions = 0
    ctx.tools.register(defineTool({
      name: 'probe', description: 'probe', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { executions += 1; return 'ran' },
    }))
    const { agent, events } = fakeAgent()
    events.push({ type: 'sandbox/mode', data: { mode: 'workspace-write' } })
    events.push({ type: 'approval/policy', data: { policy: 'ask' } })
    const execute = (id: string) => ctx.tools.execute({
      callId: CallId(id), name: 'probe', arguments: {}, agent,
      signal: new AbortController().signal,
    })

    await expect(execute('workspace')).resolves.toMatchObject({ isError: false })
    expect(evaluate).not.toHaveBeenCalled()
    events.push({ type: 'sandbox/mode', data: { mode: 'danger-full-access' } })
    await expect(execute('policy')).resolves.toMatchObject({ isError: true })
    expect(evaluate).toHaveBeenCalledOnce()
    events.push({ type: 'approval/policy', data: { policy: 'never' } })
    await expect(execute('full')).resolves.toMatchObject({ isError: false })
    expect(evaluate).toHaveBeenCalledOnce()
    expect(executions).toBe(2)
  })
})
