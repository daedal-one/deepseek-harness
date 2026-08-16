import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolPolicyService, { ToolPolicyProviderId, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
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
  it('delegates only allow and unsupported, and spends one exact ask opportunity', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolPolicyService, {})
    let current: ToolPolicyVerdict | undefined
    ctx.toolPolicy.register(ToolPolicyProviderId('fake'), { evaluate: async () => current })
    apply(ctx, { threshold: 2, ttlMs: 1_000, maxEntries: 10 })
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
    current = { providerId: ToolPolicyProviderId('fake'), decision: 'ask', risk: 60, categories: [], reason: 'review', opinions: [] }
    await expect(execute('ask-1')).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Error: Policy requires approval. Retry this exact tool call without changing its arguments (attempt 1/2).' }],
    })
    await expect(execute('ask-2')).resolves.toMatchObject({ isError: true, content: [{ text: 'Error: review' }] })
    await expect(execute('ask-3')).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Error: Policy approval opportunity was already spent for this exact tool call in the current turn.' }],
    })
    expect(executions).toBe(2)
    expect(events.filter(event => event.type === 'tool-policy/decision')).toHaveLength(10)
  })
})
