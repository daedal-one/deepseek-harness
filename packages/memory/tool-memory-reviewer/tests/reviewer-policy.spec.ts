import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import MemoryRuntime from '@deepseek-ai/dsh-memory'
import type { MemoryProvider } from '@deepseek-ai/dsh-memory'
import SubagentRuntime, { snapshotSubagentDescriptor, SubagentPrincipal } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as Reviewer from '../src/index.ts'

function execution(principal?: string): ToolRunContext {
  const descriptor = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'test', ...principal === undefined ? {} : { principal: SubagentPrincipal(principal) } })
  return { callId: 'call-1', rootCallId: 'call-1', name: 'memory_review', arguments: {}, signal: new AbortController().signal, token: Symbol('tool'), agent: { session: { events: [{ type: 'subagent/descriptor', seq: 0, time: 1, data: descriptor }] } } } as unknown as ToolRunContext
}

async function childContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(MemoryRuntime)
  return ctx
}

describe('memory reviewer principal setup', () => {
  it('keeps root and ordinary children clean and installs only in the matching child', async () => {
    const root = new Context()
    await root.plugin(SystemPrompt, {})
    await root.plugin(ToolRuntime, { mode: 'native' })
    await root.plugin(MemoryRuntime)
    await root.plugin(SubagentRuntime)
    const fiber = await root.plugin(Reviewer, { reviewerPrincipal: 'memory-reviewer' })
    const ordinary = await childContext()
    const matching = await childContext()

    expect(root.tools.schemas().map(tool => tool.name)).not.toContain('memory_review')
    expect(ordinary.tools.schemas().map(tool => tool.name)).not.toContain('memory_review')
    expect(root.subagents.applyPrincipalSetup(ordinary, undefined)).toBeUndefined()
    const setup = root.subagents.applyPrincipalSetup(matching, SubagentPrincipal('memory-reviewer'))
    setup?.commit()
    expect(matching.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining(['memory_list_pending', 'memory_review', 'memory_supersede', 'memory_delete']))
    expect(ordinary.tools.schemas().map(tool => tool.name)).not.toContain('memory_review')

    const query = vi.fn().mockResolvedValue({ memories: [], truncated: false })
    const unused = () => Promise.reject(new Error('unused'))
    matching.memory.registerProvider({ id: 'test', query, get: unused, propose: unused, challenge: unused, review: unused, supersede: unused, checkpoint: unused, delete: unused } satisfies MemoryProvider)
    const reviewerAgent = execution('memory-reviewer').agent
    if (reviewerAgent === undefined) throw new Error('reviewer fixture did not create an Agent')
    const pending = await matching.tools.execute({
      signal: new AbortController().signal,
      callId: 'pending-1' as ToolRunContext['callId'],
      name: 'memory_list_pending',
      arguments: { scope: 'global', text: 'pnpm', limit: 3 },
      agent: reviewerAgent,
    })
    expect(pending.isError).toBe(false)
    expect(query).toHaveBeenCalledWith({ scope: { kind: 'global' }, text: 'pnpm', statuses: ['proposed', 'challenged'], limit: 3 })

    await fiber.dispose()
    expect(matching.tools.schemas().map(tool => tool.name)).not.toContain('memory_review')
    expect(matching.tools.schemas().map(tool => tool.name)).not.toContain('memory_list_pending')
  })

  it('rechecks the durable descriptor principal for every execution', () => {
    expect(() => { Reviewer.assertMemoryReviewerPrincipal({ reviewerPrincipal: 'memory-reviewer' }, execution('memory-reviewer')) }).not.toThrow()
    expect(() => { Reviewer.assertMemoryReviewerPrincipal({ reviewerPrincipal: 'memory-reviewer' }, execution('ordinary')) }).toThrow('authorization denied')
    expect(() => { Reviewer.assertMemoryReviewerPrincipal({ reviewerPrincipal: 'memory-reviewer' }, execution()) }).toThrow('authorization denied')
  })
})

describe('global reviewer approval', () => {
  it('proceeds only for allowed-once and never asks for project scope', async () => {
    const request = vi.fn().mockResolvedValue('allowed-once')
    const context = { get: () => ({ request }) } as unknown as Context
    const exec = execution('memory-reviewer')
    await expect(Reviewer.approveGlobalReviewerMutation(context, exec, { kind: 'project', project: '/repo' }, 'review')).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
    await expect(Reviewer.approveGlobalReviewerMutation(context, exec, { kind: 'global' }, 'review')).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce('rejected')
    await expect(Reviewer.approveGlobalReviewerMutation(context, exec, { kind: 'global' }, 'delete')).rejects.toThrow('was not approved (rejected)')
  })
})
