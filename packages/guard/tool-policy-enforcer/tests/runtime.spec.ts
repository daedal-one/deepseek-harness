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

async function executeLogged(
  ctx: Context,
  agent: Agent,
  events: Array<Record<string, unknown>>,
  id: string,
  argumentsValue: Record<string, unknown>,
  rawArguments = JSON.stringify(argumentsValue),
) {
  const callId = CallId(id)
  const boundary = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  const turn = boundary?.type === 'turn/start' ? (boundary.data as { turn: number }).turn : 0
  events.push({ type: 'tool/call', data: { turn, step: 1, callId, name: 'probe', arguments: rawArguments } })
  const result = await ctx.tools.execute({
    callId, name: 'probe', arguments: argumentsValue, agent,
    signal: new AbortController().signal,
  })
  events.push({
    type: 'tool/result',
    data: {
      turn,
      step: 1,
      message: {
        content: [{ type: 'tool-result', toolCallId: callId, content: result.content, isError: result.isError }],
      },
    },
  })
  return result
}

describe('tool-policy enforcement through ToolRuntime', () => {
  it('accepts an omitted activation condition but rejects explicit empty lists', () => {
    expect(Config({})).toEqual({ approvalThreshold: 3 })
    expect(() => Config({ enforceWhen: { sandboxModes: [] } }))
      .toThrow(/sandboxModes/)
    expect(() => Config({ enforceWhen: { approvalPolicies: [] } }))
      .toThrow(/approvalPolicies/)
    expect(() => Config({ approvalThreshold: 1 })).toThrow(/approvalThreshold/)
    expect(() => Config({ approvalThreshold: 2.5 })).toThrow(/approvalThreshold/)
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

  it('defers identical asks twice, prompts from the third denial, and resets after success', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolPolicyService, {})
    const current: ToolPolicyVerdict = {
      providerId: ToolPolicyProviderId('fake'), decision: 'ask', risk: 60,
      categories: [], reason: 'network access needs review', opinions: [],
    }
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
    const first = await executeLogged(ctx, agent, events, 'ask-1', {
      command: 'curl example', options: { beta: 2, alpha: 1 },
    })
    expect(first).toMatchObject({
      isError: true,
      content: [{ text: 'Error: Automatic policy review denied this call without asking the user (attempt 1/3): network access needs review. Change approach or retry this exact tool call; attempt 3 asks the user.' }],
    })
    const second = await executeLogged(
      ctx,
      agent,
      events,
      'ask-2',
      { options: { alpha: 1, beta: 2 }, command: 'curl example' },
      '{"options":{"beta":2,"alpha":1},"command":"curl example"}',
    )
    expect(second).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('(attempt 2/3)') }] })
    expect(prompted).not.toHaveBeenCalled()
    await expect(executeLogged(ctx, agent, events, 'ask-3', {
      command: 'curl example', options: { alpha: 1, beta: 2 },
    })).resolves.toMatchObject({ isError: false })
    expect(prompted).toHaveBeenCalledOnce()
    const afterSuccess = await executeLogged(ctx, agent, events, 'ask-4', {
      command: 'curl example', options: { alpha: 1, beta: 2 },
    })
    expect(afterSuccess).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('(attempt 1/3)') }] })
    expect(prompted).toHaveBeenCalledOnce()
    expect(executions).toBe(1)
    expect(events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    expect(events.filter(event => event.type === 'approval/decided')).toHaveLength(1)
    const effective = events
      .filter(event => event.type === 'tool-policy/decision')
      .map(event => event.data as { stage: string; effectiveDecision: string; reason: string })
      .filter(event => event.stage === 'effective')
    expect(effective.map(event => event.effectiveDecision)).toEqual(['deny', 'deny', 'ask', 'deny'])
    expect(effective[0]?.reason).toContain('network access needs review')
  })

  it('breaks the denial chain on an intervening call or turn and keeps deterministic denies unapprovable', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolPolicyService, {})
    let current: ToolPolicyVerdict = {
      providerId: ToolPolicyProviderId('fake'), decision: 'ask', risk: 60,
      categories: [], reason: 'review', opinions: [],
    }
    ctx.toolPolicy.register(ToolPolicyProviderId('fake'), { evaluate: async () => current })
    apply(ctx)
    const prompted = vi.fn(() => Promise.resolve<ApprovalOutcome>('allowed-once'))
    ctx.on('approval/request', prompted)
    ctx.tools.register(defineTool({
      name: 'probe', description: 'probe', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'ran',
    }))
    const { agent, events } = fakeAgent()

    await expect(executeLogged(ctx, agent, events, 'a-1', { command: 'a' }))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('(attempt 1/3)') }] })
    await expect(executeLogged(ctx, agent, events, 'b-1', { command: 'b' }))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('(attempt 1/3)') }] })
    await expect(executeLogged(ctx, agent, events, 'a-2', { command: 'a' }))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('(attempt 1/3)') }] })
    events.push({ type: 'turn/end', data: { turn: 1 } }, { type: 'turn/start', data: { turn: 2 } })
    await expect(executeLogged(ctx, agent, events, 'a-next-turn', { command: 'a' }))
      .resolves.toMatchObject({ content: [{ text: expect.stringContaining('(attempt 1/3)') }] })
    current = {
      providerId: ToolPolicyProviderId('fake'), decision: 'deny', risk: 90,
      categories: [], reason: 'forbidden', opinions: [],
    }
    await expect(executeLogged(ctx, agent, events, 'deny', { command: 'a' }))
      .resolves.toMatchObject({ isError: true, content: [{ text: 'Error: forbidden' }] })
    expect(prompted).not.toHaveBeenCalled()
  })

  it('keeps exact asks approval-eligible after the user rejects at the threshold', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolPolicyService, {})
    ctx.toolPolicy.register(ToolPolicyProviderId('fake'), { evaluate: async () => ({
      providerId: ToolPolicyProviderId('fake'), decision: 'ask', risk: 60,
      categories: [], reason: 'review', opinions: [],
    }) })
    apply(ctx)
    const prompted = vi.fn(() => Promise.resolve<ApprovalOutcome>('rejected'))
    ctx.on('approval/request', prompted)
    ctx.tools.register(defineTool({
      name: 'probe', description: 'probe', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'ran',
    }))
    const { agent, events } = fakeAgent()

    await executeLogged(ctx, agent, events, 'reject-1', { command: 'same' })
    await executeLogged(ctx, agent, events, 'reject-2', { command: 'same' })
    await expect(executeLogged(ctx, agent, events, 'reject-3', { command: 'same' }))
      .resolves.toMatchObject({ isError: true, content: [{ text: 'Error: the user rejected tool "probe"' }] })
    await expect(executeLogged(ctx, agent, events, 'reject-4', { command: 'same' }))
      .resolves.toMatchObject({ isError: true, content: [{ text: 'Error: the user rejected tool "probe"' }] })
    expect(prompted).toHaveBeenCalledTimes(2)
  })

  it('uses the configured approval threshold', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolPolicyService, {})
    ctx.toolPolicy.register(ToolPolicyProviderId('fake'), { evaluate: async () => ({
      providerId: ToolPolicyProviderId('fake'), decision: 'ask', risk: 60,
      categories: [], reason: 'review', opinions: [],
    }) })
    apply(ctx, { approvalThreshold: 2 })
    const prompted = vi.fn(() => Promise.resolve<ApprovalOutcome>('allowed-once'))
    ctx.on('approval/request', prompted)
    ctx.tools.register(defineTool({
      name: 'probe', description: 'probe', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'ran',
    }))
    const { agent, events } = fakeAgent()

    await expect(executeLogged(ctx, agent, events, 'configured-1', { command: 'same' }))
      .resolves.toMatchObject({ isError: true, content: [{ text: expect.stringContaining('(attempt 1/2)') }] })
    await expect(executeLogged(ctx, agent, events, 'configured-2', { command: 'same' }))
      .resolves.toMatchObject({ isError: false })
    expect(prompted).toHaveBeenCalledOnce()
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
