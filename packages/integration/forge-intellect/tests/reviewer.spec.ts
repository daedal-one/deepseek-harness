import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AgentModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { reviewPacket } from '../src/reviewer.ts'
import type { Packet } from '../src/contract.ts'

const schema = 'forge-intellect-verification-agent/v1' as const
const properties = {
  schema: { const: schema }, role: { const: 'assessor' },
  selected_checks: { type: 'array', items: { type: 'string' } },
  additional_reads: { type: 'array', items: { type: 'string' } },
  probes: { type: 'array', items: { type: 'object', properties: {} } },
  concerns: { type: 'array', items: { type: 'string' } },
}
const packet: Packet = {
  schema, role: 'assessor', stage: 'plan', context: { obligations: [], sources: {} },
  checks: [{ id: 'check' }], repository_files: ['source.ts'],
  response_contract: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
}
const response = { schema, role: 'assessor', selected_checks: ['check'], additional_reads: ['source.ts'], probes: [], concerns: ['A check may be insufficient.'] }
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
class Reviewer extends LlmAdapter {
  requests: GenerateOptions[] = []
  constructor(private respond: (count: number, request: GenerateOptions) => Promise<string>) { super() }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const text = await this.respond(this.requests.length, request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
async function fixture(respond: (count: number, request: GenerateOptions) => Promise<string>) {
  const directory = await mkdtemp(join(tmpdir(), 'intellect-reviewer-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentModelConfig, { provider: 'fixture', model: 'reviewer' })
  const adapter = new Reviewer(respond)
  ctx.llm.registerAdapter(['fixture'], adapter)
  await mountAgentLoopTestHarness(ctx)
  const controller = new AbortController()
  const run = () => reviewPacket(ctx, packet, { provider: 'fixture', model: 'reviewer' }, 1024, directory, controller.signal)
  const events = async () => JSON.parse(await readFile(join(directory, 'session-events.json'), 'utf8')) as { type: string; data: unknown }[]
  return { ctx, directory, adapter, controller, run, events }
}

describe('independent reviewers', () => {
  it('uses a fresh tool-free session and retains raw evidence and runtime identity', async () => {
    const f = await fixture(async () => JSON.stringify(response))
    const first = await f.run()
    const second = await f.run()
    expect(first).toMatchObject({ finish_reason: 'completed', response, identity: { provider: 'fixture', model: 'reviewer', max_tokens: 1024 } })
    expect(first.identity).not.toEqual(second.identity)
    expect(f.adapter.requests.every(request => !request.tools?.length)).toBe(true)
    expect(f.adapter.requests.every(request => request.messages.filter(message => message.role === 'user').length === 1)).toBe(true)
    expect((await f.events()).findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'completed' } } })
  })
  it('corrects protocol structure while preserving substantive concerns', async () => {
    const f = await fixture(async count => JSON.stringify(count === 1 ? { ...response, stage: 'plan' } : response))
    expect(await f.run()).toMatchObject({ response, identity: { protocol_corrections: [expect.stringContaining('unexpected stage')] } })
    expect(f.adapter.requests).toHaveLength(2)
    expect((await f.events()).filter(event => event.type === 'user/message')).toHaveLength(2)
  })
  it('fails after three invalid responses and retains every attempt', async () => {
    const f = await fixture(async () => JSON.stringify({ ...response, selected_checks: ['invented'] }))
    await expect(f.run()).rejects.toThrow('invalid response after 3 attempts')
    expect(f.adapter.requests).toHaveLength(3)
    expect((await f.events()).filter(event => event.type === 'assistant/message')).toHaveLength(3)
  })
  it('awaits reviewer cancellation and persists the cancelled turn', async () => {
    const entered = Promise.withResolvers<undefined>()
    let settled = false
    const f = await fixture(async (_count, request) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) => { request.signal!.addEventListener('abort', () => { resolve() }, { once: true }) })
      settled = true
      return ''
    })
    const result = f.run()
    const failure = expect(result).rejects.toThrow('cancelled')
    await entered.promise
    f.controller.abort()
    await failure
    expect(settled).toBe(true)
    expect((await f.events()).findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'aborted' } } })
  })
  it.each([new Error('inbox unavailable'), 'inbox unavailable'])('retains evidence when dispatch throws %s', async (failure) => {
    const f = await fixture(async () => JSON.stringify(response))
    const create = f.ctx.agents.create.bind(f.ctx.agents)
    vi.spyOn(f.ctx.agents, 'create').mockImplementation(async (request) => {
      const handle = await create(request)
      vi.spyOn(handle.agent, 'followup').mockImplementation(() => { throw failure })
      return handle
    })
    await expect(f.run()).rejects.toThrow(failure instanceof Error ? failure.message : 'Reviewer could not start')
    expect(f.adapter.requests).toHaveLength(0)
    expect(await f.events()).toEqual(expect.any(Array))
  })

  it('persists partial evidence while waiting for the model', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<string>()
    const f = await fixture(async () => { entered.resolve(undefined); return release.promise })
    const result = f.run()
    try {
      await entered.promise
      await vi.advanceTimersByTimeAsync(2000)
      await vi.waitFor(async () => { expect((await f.events()).some(event => event.type === 'user/message')).toBe(true) })
    } finally { release.resolve(JSON.stringify(response)); await result }
  })

  it('fails the review when partial evidence cannot be persisted', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<string>()
    const f = await fixture(async () => { entered.resolve(undefined); return release.promise })
    await mkdir(join(f.directory, 'session-events.json'))
    const result = f.run()
    const failure = expect(result).rejects.toThrow()
    await entered.promise
    await vi.advanceTimersByTimeAsync(2000)
    release.resolve(JSON.stringify(response))
    await failure
  })

  it('refuses a reviewer turn that terminates on a provider error', async () => {
    const f = await fixture(async () => { throw new Error('provider unavailable') })
    await expect(f.run()).rejects.toThrow('did not complete')
    expect((await f.events()).findLast(event => event.type === 'turn/end')).toBeDefined()
  })

  it('denies execution even when another plugin contributes a reviewer-local tool', async () => {
    const f = await fixture(async () => JSON.stringify(response))
    const create = f.ctx.agents.create.bind(f.ctx.agents)
    let called = false
    vi.spyOn(f.ctx.agents, 'create').mockImplementation(async (request) => {
      let scoped: Context | undefined
      const handle = await create({ ...request, setup: async (ctx, agent) => {
        await request.setup?.(ctx, agent)
        scoped = ctx
        ctx.tools.register(defineTool({ name: 'injected', description: 'Fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute: async () => { called = true; return 'executed' } }))
      } })
      const result = await scoped!.tools.execute({ name: 'injected', arguments: {}, agent: handle.agent, callId: ToolCallId('injected'), signal: new AbortController().signal })
      expect(JSON.stringify(result)).toContain('Verification reviewers cannot execute tools')
      return handle
    })
    await f.run()
    expect(called).toBe(false)
  })

})
