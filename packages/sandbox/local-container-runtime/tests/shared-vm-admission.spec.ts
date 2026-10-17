import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceAdmissionId } from '../src/workspace-types.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { SharedVmAdmission } from '../src/shared-vm-admission.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], root?: string, lateAdmission = false) {
  const directory = root ?? await mkdtemp(join(tmpdir(), 'dsh-shared-admission-'))
  if (root === undefined) cleanup.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SessionStore); await ctx.plugin(Projections)
  await ctx.plugin(Persistence, { root: directory, compression: 'none' })
  await ctx.plugin(Llm); await ctx.plugin(AgentRegistry); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(script); ctx.llm.registerAdapter(['mock'], adapter)
  const create = async (id: string, parentAgent?: Agent) => await ctx.agents.create({
    sessionId: SessionId(id), ...parentAgent === undefined ? {} : { parentAgent }, agentOptions: { provider: 'mock', model: 'main' },
  })
  const untracked = lateAdmission ? await create('preexisting') : undefined
  const admission = new SharedVmAdmission(ctx, 1)
  ctx.effect(() => async () => { await admission.close() }, 'shared turn admission fixture')
  return { ctx, adapter, create, directory, admission, untracked }
}

function send(handle: AgentHandle, text = 'Finish this task.'): void {
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}
function statuses(handle: AgentHandle): string[] {
  return handle.agent.session.snapshotEvents().filter(event => event.type === 'workspace/admission').map(event => event.data.status)
}

describe('shared environment turn admission', () => {
  it('refuses invalid active capacity and admission after its owner closes', async () => {
    const ctx = new Context()
    cleanup.push(async () => { await ctx.fiber.dispose() })
    expect(() => new SharedVmAdmission(ctx, 0)).toThrow('invalid conversation capacity')
    const f = await fixture([]); await f.admission.close()
    await expect(f.create('closed')).rejects.toThrow('runtime is closing')
  })

  it('reconciles orphaned waiting records on resume without executing their inbox', async () => {
    const first = await fixture([]); const original = await first.create('orphan')
    original.agent.session.append('workspace/admission', {
      id: brandString<WorkspaceAdmissionId>('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), status: 'waiting',
    })
    const completed = brandString<WorkspaceAdmissionId>('bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee')
    original.agent.session.append('workspace/admission', { id: completed, status: 'waiting' })
    original.agent.session.append('workspace/admission', { id: completed, status: 'admitted' })
    await original.dispose()
    const resumed = await first.ctx.agents.resume({ resumeSessionId: original.agent.id,
      agentOptions: { provider: 'mock', model: 'main' } })
    expect(statuses(resumed)).toEqual(['waiting', 'waiting', 'admitted', 'cancelled'])
    expect(first.adapter.requests).toHaveLength(0)
  })

  it('rejects late installation and reentrant admission without releasing another turn', async () => {
    const late = await fixture([], undefined, true)
    await expect(late.create('untracked-child', late.untracked!.agent)).rejects.toThrow('no execution admission owner')
    await expect(late.untracked!.agent.ctx.waterfall('agent/turn-starting', {
      agent: late.untracked!.agent, signal: new AbortController().signal,
    }, () => undefined)).rejects.toThrow('no execution admission owner')
    const f = await fixture(['hang']); const first = await f.create('first'); send(first)
    await expect.poll(() => f.adapter.requests.length).toBe(1)
    await expect(first.agent.ctx.waterfall('agent/turn-starting', {
      agent: first.agent, signal: new AbortController().signal,
    }, () => undefined)).rejects.toThrow('already holds turn admission')
    await f.admission.close()
    await expect(first.agent.ctx.waterfall('agent/turn-starting', {
      agent: first.agent, signal: new AbortController().signal,
    }, () => undefined)).rejects.toThrow('runtime is closing')
    expect(f.adapter.requests).toHaveLength(1)
  })

  it.each([new Error('lower admission failed'), 'plugin failure'])('records a downstream admission failure and releases capacity: %s', async (reason) => {
    const f = await fixture([]); const first = await f.create('first')
    const remove = f.ctx.on('agent/turn-starting', () => { throw reason })
    await expect(first.agent.ctx.waterfall('agent/turn-starting', {
      agent: first.agent, signal: new AbortController().signal,
    }, () => undefined)).rejects.toBe(reason)
    expect(statuses(first)).toEqual(['waiting', 'admitted', 'failed'])
    remove()
    await first.agent.ctx.waterfall('agent/turn-starting', {
      agent: first.agent, signal: new AbortController().signal,
    }, () => undefined)
    expect(statuses(first)).toEqual(['waiting', 'admitted', 'failed', 'waiting', 'admitted'])
  })

  it('creates idle Sessions freely, queues roots in order, and cancels only one waiter', async () => {
    const f = await fixture(['hang', 'hang', textResponse('Done.')])
    const handles = await Promise.all(['one', 'two', 'three', 'four', 'idle'].map(id => f.create(id)))
    expect(f.adapter.requests).toHaveLength(0)
    send(handles[0]!); await expect.poll(() => f.adapter.requests.length).toBe(1)
    for (const handle of handles.slice(1, 4)) send(handle)
    await expect.poll(() => statuses(handles[3]!)).toEqual(['waiting'])
    expect(statuses(handles[1]!)).toEqual(['waiting'])
    handles[2]!.agent.cancel({ kind: 'user' }); await handles[2]!.agent.whenIdle()
    expect(statuses(handles[2]!)).toEqual(['waiting', 'cancelled'])
    expect(handles[2]!.agent.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(false)
    expect(f.adapter.requests).toHaveLength(1)
    handles[0]!.agent.cancel({ kind: 'user' }); await handles[0]!.agent.whenIdle()
    await expect.poll(() => f.adapter.requests.length).toBe(2)
    expect(statuses(handles[1]!)).toEqual(['waiting', 'admitted'])
    expect(statuses(handles[3]!)).toEqual(['waiting'])
    handles[1]!.agent.cancel({ kind: 'user' }); await handles[1]!.agent.whenIdle()
    await handles[3]!.agent.whenIdle()
    expect(statuses(handles[3]!)).toEqual(['waiting', 'admitted'])
    expect(f.adapter.requests).toHaveLength(3)
  })

  it('admits a child behind a waiting unrelated root and holds the root permit until the child settles', async () => {
    const f = await fixture(['hang', 'hang', textResponse('Next root.')])
    const parent = await f.create('parent'); const other = await f.create('other')
    send(parent); await expect.poll(() => f.adapter.requests.length).toBe(1)
    send(other); await expect.poll(() => statuses(other)).toEqual(['waiting'])
    const child = await f.create('child', parent.agent); send(child)
    await expect.poll(() => f.adapter.requests.length).toBe(2)
    expect(statuses(child)).toEqual(['waiting', 'admitted'])
    parent.agent.cancel({ kind: 'user' }); await parent.agent.whenIdle()
    expect(statuses(other)).toEqual(['waiting'])
    child.agent.cancel({ kind: 'user' }); await child.agent.whenIdle()
    await other.agent.whenIdle()
    expect(statuses(other)).toEqual(['waiting', 'admitted'])
  })

  it('retains queued input across shutdown and re-enters admission once after resume', async () => {
    const first = await fixture(['hang'])
    const running = await first.create('running'); const waiting = await first.create('waiting')
    send(running); await expect.poll(() => first.adapter.requests.length).toBe(1)
    send(waiting, 'Retain the queued message.')
    await expect.poll(() => statuses(waiting)).toEqual(['waiting'])
    const prefix = waiting.agent.session.snapshotEvents()
    expect(waiting.agent.inbox.nextTurn).toHaveLength(1)
    await first.ctx.fiber.dispose()
    const second = await fixture([textResponse('Recovered.'), textResponse('Awake.')], first.directory)
    const resumed = await second.ctx.agents.resume({ resumeSessionId: waiting.agent.id,
      agentOptions: { provider: 'mock', model: 'main' } })
    expect(resumed.agent.session.snapshotEvents().slice(0, prefix.length)).toEqual(prefix)
    expect(resumed.agent.inbox.nextTurn).toHaveLength(1)
    expect(second.adapter.requests).toHaveLength(0)
    send(resumed, 'Continue.')
    await resumed.agent.whenIdle()
    expect(resumed.agent.inbox.nextTurn).toHaveLength(0)
    expect(second.adapter.requests).toHaveLength(2)
    expect(JSON.stringify(second.adapter.requests[0]?.messages)).toContain('Retain the queued message.')
    expect(statuses(resumed)).toEqual(['waiting', 'cancelled', 'waiting', 'admitted', 'waiting', 'admitted'])
  })
})
