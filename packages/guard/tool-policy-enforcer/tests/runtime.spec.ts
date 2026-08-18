import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolPolicyService, { ToolPolicyProviderId, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

function fakeAgent() {
  const events: Array<Record<string, unknown>> = [{ type: 'turn/start', data: { turn: 1 } }]
  const session = {
    id: 'session', events,
    append(type: string, data: unknown) { const event = { type, data }; events.push(event); return event },
  }
  return { agent: { session } as unknown as Agent, events }
}

describe('tool-policy enforcement through ToolRuntime', () => {
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
})
