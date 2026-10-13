import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolPolicyService, { ToolPolicyProviderId, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, shouldEnforce } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fakeAgent() {
  const events: Array<Record<string, unknown>> = [{ type: 'turn/start', data: { turn: 1 } }]
  const session = {
    id: 'session', snapshotEvents: () => [...events],
    get seq() { return events.length },
    eventAt(seq: number) { return events[seq] },
    append(type: string, data: unknown) { const event = { type, data }; events.push(event); return event },
  }
  return { agent: { session } as unknown as Agent, events }
}

async function harness(options: { outcome?: ApprovalOutcome; approval?: 'never' | 'missing' | 'unavailable'; ptc?: boolean; config?: Config } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  if (options.approval !== 'missing') await ctx.plugin(ApprovalService, { policy: options.approval === 'never' ? 'never' : 'ask' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolPolicyService, {})
  const verdict = {
    providerId: ToolPolicyProviderId('fake'), decision: 'ask' as ToolPolicyVerdict['decision'], risk: 60,
    categories: [], reason: 'network access needs review', opinions: [],
  }
  const evaluate = vi.fn(async () => verdict)
  ctx.toolPolicy.register(ToolPolicyProviderId('fake'), { evaluate })
  const fiber = await ctx.plugin({ name: 'enforcer-test', inject: ['tools', 'toolPolicy'], apply }, options.config)
  const prompted = vi.fn(async (_request: { toolName: string; callId?: string; reason?: string }): Promise<ApprovalOutcome> => options.outcome ?? 'allowed-once')
  if (options.approval !== 'unavailable') ctx.on('approval/request', prompted)
  const execute = vi.fn(async () => 'ran')
  const disposeProbe = ctx.tools.register(defineTool({
    name: 'probe', description: 'probe', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute,
  }))
  const state = fakeAgent()
  function logCall(name: string, id: string, args: unknown, agentState = state) {
    const callId = ToolCallId(id)
    agentState.events.push(options.ptc
      ? { type: 'tool/ptc-dispatch-start', data: { rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: callId, name, arguments: args } }
      : { type: 'tool/call', data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) } })
    return { callId, name, arguments: args, agent: agentState.agent, signal: new AbortController().signal }
  }
  async function finishCall(input: ReturnType<typeof logCall>, agentState = state) {
    const result = await ctx.tools.execute(input)
    agentState.events.push(options.ptc
      ? { type: 'tool/ptc-dispatch', data: { subCallId: input.callId, name: input.name, arguments: input.arguments, isError: result.isError, content: result.content } }
      : { type: 'tool/result', data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: input.callId, content: result.content, isError: result.isError }] } } })
    return result
  }
  const call = (name: string, id: string, args: unknown, agentState = state) => finishCall(logCall(name, id, args, agentState), agentState)
  const probe = (id: string, args: unknown = { command: 'curl example' }) => call('probe', id, args)
  const approve = (id = 'approval', target = 'denied') => call('request_tool_approval', id, { call_id: target, justification: 'The task requires this read.' })
  return { ctx, fiber, disposeProbe, verdict, evaluate, prompted, execute, state, call, probe, approve, logCall, finishCall }
}

describe('explicit policy approval', () => {
  it('has no retry threshold configuration', () => {
    expect(Config({})).toEqual({})
    expect(() => Config({ enforceWhen: { sandboxModes: [] } })).toThrow(/sandboxModes/)
    expect(() => Config({ enforceWhen: { approvalPolicies: [] } })).toThrow(/approvalPolicies/)
  })

  it('points the first denial to direct approval and never prompts from repetition', async () => {
    const h = await harness()
    for (let i = 0; i < 5; i++) {
      expect(await h.probe(`denied-${i}`)).toMatchObject({ isError: true, content: [{ text:
        `Error: Automatic policy review denied this call without asking the user: network access needs review. Do not repeat this call to trigger approval. If the action is still necessary, call request_tool_approval with call_id "denied-${i}" and a justification, then retry this exact call only if approval succeeds.`,
      }] })
    }
    expect(h.prompted).not.toHaveBeenCalled()
    expect(h.execute).not.toHaveBeenCalled()
  })

  it.each([false, true])('grants one canonical exact call and reconstructs it after reload (PTC: %s)', async (ptc) => {
    const h = await harness({ ptc })
    const args = { command: 'curl example', nested: { beta: [2, 3], alpha: 1 } }
    await h.probe('denied', args)
    expect(await h.approve()).toMatchObject({ isError: false })
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.prompted).toHaveBeenCalledOnce()
    expect(h.prompted.mock.calls[0]?.[0]).toMatchObject({ toolName: 'probe', callId: 'approval', reason: expect.stringContaining('curl example') as unknown })
    await h.fiber.dispose()
    expect(h.ctx.tools.get('request_tool_approval')).toBeUndefined()
    await h.ctx.plugin({ name: 'enforcer-reloaded', inject: ['tools', 'toolPolicy'], apply })
    expect(await h.probe('changed', { ...args, command: 'curl other' })).toMatchObject({ isError: true })
    expect(await h.probe('granted', { nested: { alpha: 1, beta: [2, 3] }, command: 'curl example' })).toMatchObject({ isError: false })
    expect(await h.probe('consumed', args)).toMatchObject({ isError: true })
    expect(h.execute).toHaveBeenCalledOnce()
    expect(h.prompted).toHaveBeenCalledOnce()
  })

  it('consumes a grant in logged call order when matching calls overlap', async () => {
    const h = await harness()
    await h.probe('denied')
    await h.approve()
    const first = h.logCall('probe', 'first', { command: 'curl example' })
    const second = h.logCall('probe', 'second', { command: 'curl example' })
    const results = await Promise.all([h.finishCall(first), h.finishCall(second)])
    expect(results.map(result => result.isError)).toEqual([false, true])
    expect(h.execute).toHaveBeenCalledOnce()
  })

  it('requires a completed denial and rejects cross-session, stale, or arbitrary call ids', async () => {
    const h = await harness()
    expect(await h.approve()).toMatchObject({ isError: true })
    await h.probe('denied')
    const other = fakeAgent()
    expect(await h.call('request_tool_approval', 'foreign', { call_id: 'denied', justification: 'needed' }, other)).toMatchObject({ isError: true })
    h.state.events.push({ type: 'turn/end', data: { turn: 1 } }, { type: 'turn/start', data: { turn: 2 } })
    expect(await h.approve('stale')).toMatchObject({ isError: true })
    expect(h.prompted).not.toHaveBeenCalled()
  })

  it('requires a successful approval-tool result even when the answerer granted', async () => {
    const h = await harness()
    await h.probe('denied')
    const controller = new AbortController()
    h.ctx.on('tools/post-execute', async (exec, _result, next) => {
      if (exec.name === 'request_tool_approval') controller.abort(new Error('cancelled before delivery'))
      return next()
    })
    const input = h.logCall('request_tool_approval', 'approval', { call_id: 'denied', justification: 'needed' })
    expect(await h.finishCall({ ...input, signal: controller.signal })).toMatchObject({ isError: true })
    expect(h.state.events).toContainEqual(expect.objectContaining({ type: 'approval/decided', data: expect.objectContaining({ outcome: 'allowed-once' }) as unknown }))
    expect(await h.probe('not-granted')).toMatchObject({ isError: true })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('expires a successful grant at the turn boundary', async () => {
    const h = await harness()
    await h.probe('denied')
    await h.approve()
    h.state.events.push({ type: 'turn/end', data: { turn: 1 } }, { type: 'turn/start', data: { turn: 2 } })
    expect(await h.probe('next-turn')).toMatchObject({ isError: true })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'cancelled', 'unavailable'] as const)('does not issue a grant after %s approval', async (outcome) => {
    const h = await harness({ outcome })
    await h.probe('denied')
    expect(await h.approve()).toMatchObject({ isError: true, content: [{ text: `Error: tool approval ${outcome}; do not execute the denied action` }] })
    expect(await h.probe('again')).toMatchObject({ isError: true })
    expect(await h.approve('same-denial')).toMatchObject({ isError: true })
    if (outcome === 'rejected') expect(await h.approve('new-denial', 'again')).toMatchObject({ isError: true })
    expect(h.prompted).toHaveBeenCalledOnce()
    expect(h.execute).not.toHaveBeenCalled()
  })

  it.each(['never', 'missing', 'unavailable'] as const)('fails closed with %s approval support', async (approval) => {
    const h = await harness({ approval })
    await h.probe('denied')
    expect(await h.approve()).toMatchObject({ isError: true })
    expect(await h.probe('again')).toMatchObject({ isError: true })
    expect(h.prompted).not.toHaveBeenCalled()
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('never approves a deterministic denial and rechecks policy after a grant', async () => {
    const h = await harness()
    h.verdict.decision = 'deny'
    expect(await h.probe('forbidden')).toMatchObject({ isError: true })
    expect(await h.approve('forbidden-approval', 'forbidden')).toMatchObject({ isError: true })
    expect(h.prompted).not.toHaveBeenCalled()
    h.verdict.decision = 'ask'
    await h.probe('denied')
    await h.approve()
    h.verdict.decision = 'deny'
    expect(await h.probe('revoked')).toMatchObject({ isError: true })
    h.verdict.decision = 'ask'
    expect(await h.probe('spent')).toMatchObject({ isError: true })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('does not issue multiple grants from concurrent approval requests', async () => {
    const h = await harness()
    await h.probe('denied')
    let settle!: (value: ApprovalOutcome) => void
    h.prompted.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    const first = h.approve('first')
    await vi.waitFor(() => { expect(h.prompted).toHaveBeenCalledOnce() })
    try {
      expect(await h.approve('second')).toMatchObject({ isError: true })
    } finally {
      settle('allowed-once')
      await first
    }
    expect(h.prompted).toHaveBeenCalledOnce()
  })

  it('can approve a new denial after a previous grant was consumed', async () => {
    const h = await harness()
    await h.probe('denied')
    await h.approve()
    await h.probe('granted')
    await h.probe('second-denial')
    expect(await h.approve('second-approval', 'second-denial')).toMatchObject({ isError: false })
    expect(await h.probe('second-granted')).toMatchObject({ isError: false })
    expect(h.prompted).toHaveBeenCalledTimes(2)
    expect(h.execute).toHaveBeenCalledTimes(2)
  })

  it('ignores malformed or empty recorded arguments instead of treating them as grants', async () => {
    const h = await harness()
    for (const [id, args] of [['malformed', '{'], ['empty', '']]) {
      h.state.events.push({ type: 'tool/call', data: { turn: 1, step: 1, callId: ToolCallId(id!), name: 'request_tool_approval', arguments: args } })
    }
    expect(await h.probe('denied')).toMatchObject({ isError: true })
    expect(await h.approve()).toMatchObject({ isError: false })
    expect(await h.probe('granted')).toMatchObject({ isError: false })
  })

  it('returns an explicit approval hint when policy evaluation fails, but preserves cancellation', async () => {
    const h = await harness()
    h.evaluate.mockRejectedValueOnce(new Error('offline'))
    expect(await h.probe('unavailable')).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('tool policy is unavailable') as unknown }] })
    const controller = new AbortController()
    h.evaluate.mockImplementationOnce(async () => {
      controller.abort(new Error('stopped'))
      throw controller.signal.reason
    })
    const input = h.logCall('probe', 'cancelled', {})
    expect(await h.finishCall({ ...input, signal: controller.signal })).toMatchObject({ isError: true })
    expect(h.prompted).not.toHaveBeenCalled()
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('prewarms relevant events, contains preparation failure, and respects permission scope and disposal', async () => {
    const h = await harness({ config: { enforceWhen: { approvalPolicies: ['ask'] } } })
    const prepare = vi.spyOn(h.ctx.toolPolicy, 'prewarm').mockRejectedValue(new Error('offline'))
    const emit = (event: Record<string, unknown>) => { h.ctx.emit('session/event', h.state.agent.session, event as SessionEvent) }
    emit({ type: 'step/start', data: { turn: 1, step: 1 } })
    emit({ type: 'user/message', data: { source: { kind: 'plugin' }, content: [] } })
    emit({ type: 'user/message', data: { source: { kind: 'user' }, content: [] } })
    emit({ type: 'sandbox/mode', data: { mode: 'danger-full-access' } })
    emit({ type: 'approval/policy', data: { policy: 'ask' } })
    await vi.waitFor(() => { expect(prepare).toHaveBeenCalledTimes(3) })
    h.state.events.push({ type: 'approval/policy', data: { policy: 'never' } })
    emit({ type: 'approval/policy', data: { policy: 'never' } })
    await Promise.resolve()
    expect(prepare).toHaveBeenCalledTimes(3)
    emit({ type: 'approval/policy', data: { policy: 'ask' } })
    await h.fiber.dispose()
    await Promise.resolve()
    expect(prepare).toHaveBeenCalledTimes(3)
  })

  it('requires a justification and an available target tool', async () => {
    const h = await harness()
    await h.probe('denied')
    expect(await h.call('request_tool_approval', 'empty', { call_id: 'denied', justification: ' ' })).toMatchObject({ isError: true })
    const noAgent = await h.ctx.tools.execute({ callId: ToolCallId('no-agent'), name: 'request_tool_approval', arguments: { call_id: 'denied', justification: 'needed' }, signal: new AbortController().signal })
    expect(noAgent).toMatchObject({ isError: true })
    h.disposeProbe()
    expect(await h.approve('missing-tool')).toMatchObject({ isError: true, content: [{ text: 'Error: the denied tool is no longer available' }] })
    expect(h.prompted).not.toHaveBeenCalled()
  })
  it('matches configured durable permission values and keeps enforcement when they are absent', () => {
    const condition = { sandboxModes: ['danger-full-access'], approvalPolicies: ['ask'] } as const
    const events = (sandbox: string, approval: string): SessionEvent[] => [
      { type: 'sandbox/mode', data: { mode: sandbox } },
      { type: 'approval/policy', data: { policy: approval } },
    ] as SessionEvent[]

    expect(shouldEnforce([], undefined)).toBe(true)
    expect(shouldEnforce(events('workspace-write', 'ask'), { sandboxModes: ['workspace-write'] })).toBe(true)
    expect(shouldEnforce([], condition)).toBe(true)
    expect(shouldEnforce(events('danger-full-access', 'ask').slice(0, 1), condition)).toBe(true)
    expect(shouldEnforce(events('danger-full-access', 'ask').slice(1), condition)).toBe(true)
    expect(shouldEnforce(events('workspace-write', 'ask'), condition)).toBe(false)
    expect(shouldEnforce(events('danger-full-access', 'ask'), condition)).toBe(true)
    expect(shouldEnforce(events('danger-full-access', 'never'), condition)).toBe(false)
  })

  it('bypasses providers outside configured permission values', async () => {
    const ctx = new Context()
    contexts.push(ctx)
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
      callId: ToolCallId(id), name: 'probe', arguments: {}, agent,
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
