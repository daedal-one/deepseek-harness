/** Explicit human consent, execution scope, and authenticated cross-profile delivery. */
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import * as presetServices from '@deepseek-ai/dsh-agent-presets'
import { isHostExecution } from '../src/world.ts'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-presets'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Questions from '@deepseek-ai/dsh-user-questions'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Handoff from '../src/index.ts'
import * as tool from '../src/tool.ts'
import * as receiver from '../src/receiver.ts'
import { HANDOFF_PATH, handoffSessionId, requestSchema } from '../src/protocol.ts'

const token = 'test-token-for-handoff-only-0123456789'
const contexts: Context[] = []
const roots: string[] = []
const host = Symbol.for('@deepseek-ai/dsh/host-execution-world')
const signal = (): AbortSignal => new AbortController().signal
const task = { title: 'Update running harness', task: 'Use committed branch codex/fix at abc123. Focused tests passed. Activate and verify readiness.' }
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  const disposed = await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  const removed = await Promise.allSettled(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  const failures = [...disposed, ...removed].filter(result => result.status === 'rejected').map(result => result.reason as unknown)
  if (failures.length > 0) throw new AggregateError(failures, 'Handoff fixture cleanup failed')
})
function context(): Context { const ctx = new Context(); contexts.push(ctx); return ctx }
function world(ctx: Context, identity: symbol = host): void {
  ctx.provide('fs', { executionWorld: identity } as never)
  ctx.provide('subprocess', { executionWorld: identity } as never)
}
async function destination(publicUrl?: string) {
  const ctx = context()
  world(ctx)
  const create = vi.fn(async () => ({ sessionId: SessionId('unused') }))
  const prompt = vi.fn(async (_request: unknown, _signal: AbortSignal) => ({ accepted: true as const }))
  ctx.provide('sessionController', { create, prompt } as never)
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-handoff-')); roots.push(cwd)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const seen = vi.fn<(request: IncomingMessage) => void>()
  const register = ctx.webServer.register.bind(ctx.webServer)
  vi.spyOn(ctx.webServer, 'register').mockImplementation(route => register({ ...route, handler(req, res) {
    seen(req)
    return route.handler(req, res)
  } }))
  const fiber = ctx.plugin(receiver, { name: 'Maintenance host', cwd, token, ...publicUrl === undefined ? {} : { publicUrl }, maxBytes: 8192, timeoutMs: 5000 })
  await fiber
  const url = `http://127.0.0.1:${ctx.webServer.port}`
  const request = { sourceSessionId: 'source', callId: 'call', preset: 'daedal' as const, destination: { name: 'Maintenance host', cwd }, ...task }
  const send = (body: unknown = request, auth = token, method = 'POST') => fetch(url + HANDOFF_PATH, {
    method, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    ...method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {},
  })
  return { ctx, fiber, create, prompt, url, request, send, seen }
}
async function source(url?: string, preset = 'daedal', identity = Symbol('container')) {
  const ctx = context()
  world(ctx, identity)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  ctx.sessionProjections.register(agentPresetProjectionDefinition)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  await ctx.plugin(Questions)
  const handoffFiber = ctx.plugin(Handoff, { ...url === undefined ? {} : { destinationUrl: url, token }, timeoutMs: 5000, maxBytes: 8192 })
  await handoffFiber
  const session = ctx.sessions.create(SessionId('source'), { meta: { agentPreset: preset } })
  const agent = { id: session.id, session, ctx, status: 'idle' } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, handoffFiber, run: (abort = signal()) => ctx.daedalHandoff.handoff(agent, ToolCallId('call'), task, abort) }
}
function approve(ctx: Context, selected = ['Start host session'], custom?: string) {
  return ctx.on('user-questions/request', async request => ({ answers: [{
    id: request.questions[0]!.id, selected, ...custom === undefined ? {} : { custom },
  }] }))
}

describe('Daedal host handoff', () => {
  it('uses preset-owned providers before inherited service providers', async () => {
    const { ctx, agent } = await source()
    expect(isHostExecution(ctx, agent)).toBe(false)
    await ctx.plugin(tool)
    expect(renderContextSnapshot(await ctx.systemPrompt.assemble({ agent, scope: agent }))).toContain('isolated workspace')
    vi.spyOn(presetServices, 'serviceForAgent').mockReturnValue({ executionWorld: host } as never)
    expect(isHostExecution(ctx, agent)).toBe(true)
    expect(renderContextSnapshot(await ctx.systemPrompt.assemble({ agent, scope: agent }))).toContain('Execution environment: host')
  })

  it.each([
    { destinationUrl: 'https://host.example' }, { token },
    { destinationUrl: 'http://host.example', token },
    { destinationUrl: 'https://host.example/path', token },
    { destinationUrl: 'https://host.example', token: 'short' },
  ])('rejects incomplete or unsafe destination configuration %j', (config) => {
    expect(() => new Handoff(context(), { ...config, timeoutMs: 5000, maxBytes: 8192 })).toThrow('daedal-handoff requires')
  })

  it('accepts a separately configured HTTPS destination', () => {
    expect(() => new Handoff(context(), { destinationUrl: 'https://host.example', token, timeoutMs: 5000, maxBytes: 8192 })).not.toThrow()
  })

  it.each([
    () => new Response(null, { status: 204 }),
    () => new Response('x'.repeat(8193)),
  ])('refuses empty or oversized discovery responses before asking for consent', async (response) => {
    const { ctx, run } = await source('https://host.example')
    const ask = vi.spyOn(ctx.userQuestions, 'ask')
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    await expect(run()).rejects.toThrow()
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses an oversized complete task before asking for consent', async () => {
    const target = await destination(); const { ctx, agent } = await source(target.url)
    const ask = vi.spyOn(ctx.userQuestions, 'ask')
    await expect(ctx.daedalHandoff.handoff(agent, ToolCallId('large'),
      { ...task, task: 'x'.repeat(8193) }, signal())).rejects.toThrow('byte limit')
    expect(ask).not.toHaveBeenCalled()
    expect(target.create).not.toHaveBeenCalled()
  })

  it('reports a mismatched acknowledgement as uncertain without dispatching again', async () => {
    const { ctx, run } = await source('https://host.example')
    approve(ctx)
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ name: 'Host', cwd: '/srv' }))
      .mockResolvedValueOnce(Response.json({ sessionId: 'different-session', accepted: true }))
    vi.stubGlobal('fetch', fetcher)
    expect(await run()).toMatchObject({ status: 'unknown' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects direct host execution and presents missing configuration through the tool', async () => {
    const mounted = await source(undefined, 'daedal', host)
    await expect(mounted.run()).rejects.toThrow('already runs on the host')
    const isolated = await source()
    await isolated.ctx.plugin(tool)
    const definition = isolated.ctx.tools.get('handoff_to_host')!
    expect(definition.presentCall?.(task)).toMatchObject({ title: 'Request host handoff' })
    const execute = (agent?: Agent) => isolated.ctx.tools.execute({ name: 'handoff_to_host', arguments: task,
      ...agent === undefined ? {} : { agent }, callId: ToolCallId('tool'), signal: signal() })
    expect((await execute()).isError).toBe(true)
    expect(JSON.stringify((await execute(isolated.agent)).content)).toContain('unavailable')
    await isolated.handoffFiber.dispose()
    expect(JSON.stringify((await execute(isolated.agent)).content)).toContain('not configured')
  })

  it('shows the public browser address while keeping transport on loopback', async () => {
    const target = await destination('http://100.94.63.54:3083')
    const { ctx, run } = await source(target.url)
    ctx.on('user-questions/request', async (request) => {
      expect(request.questions[0]?.detail).toContain('http://100.94.63.54:3083')
      return { answers: [{ id: 'daedal-host-handoff', selected: ['Start host session'] }] }
    })
    expect(await run()).toMatchObject({ status: 'started', destinationUrl: 'http://100.94.63.54:3083' })
    target.prompt.mockRejectedValueOnce(new Error('lost acknowledgement'))
    expect(await run()).toMatchObject({ status: 'unknown', destinationUrl: 'http://100.94.63.54:3083' })
    expect((await target.send()).status).toBe(409)
  })

  it('refuses non-browser public destination URLs', async () => {
    await expect(destination('file:///tmp')).rejects.toThrow()
  })

  it('does not send work until the human approves the exact destination and task', async () => {
    const target = await destination()
    const { ctx, run } = await source(target.url, 'daedal-openai')
    const asked = Promise.withResolvers<undefined>()
    const decision = Promise.withResolvers<undefined>()
    ctx.on('user-questions/request', async (request) => {
      expect(request.questions[0]?.detail).toContain(task.task)
      expect(request.questions[0]?.detail).toContain(target.request.destination.cwd)
      expect(request.questions[0]?.detail).toContain('daedal-openai')
      asked.resolve(undefined); await decision.promise
      return { answers: [{ id: 'daedal-host-handoff', selected: ['Start host session'] }] }
    })
    const running = run()
    await asked.promise
    expect(target.create).not.toHaveBeenCalled()
    decision.resolve(undefined)
    expect(await running).toMatchObject({ status: 'started', destination: 'Maintenance host' })
    expect(target.create).toHaveBeenCalledWith(expect.objectContaining({ cwd: target.request.destination.cwd, agentPreset: 'daedal-openai' }))
    expect(target.prompt).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: expect.stringContaining(task.task) as string }] }), expect.any(AbortSignal))
  })

  it.each([[['Stay here'], undefined], [[], 'yes'], [['Start host session', 'Stay here'], undefined], [['Start host session'], 'but change the task']])(
    'does not infer consent from %j or free text', async (selected, custom) => {
      const target = await destination(); const { ctx, run } = await source(target.url)
      approve(ctx, selected, custom)
      expect(await run()).toMatchObject({ status: 'declined' })
      expect(target.create).not.toHaveBeenCalled()
    })

  it('keeps missing configuration and missing answerers from starting work', async () => {
    const empty = await source()
    expect(await empty.run()).toMatchObject({ status: 'unavailable' })
    const target = await destination(); const ready = await source(target.url)
    await expect(ready.run()).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    expect(target.create).not.toHaveBeenCalled()
  })

  it('cancels after review without dispatch even if the answerer returns approval', async () => {
    const target = await destination(); const { ctx, run } = await source(target.url)
    const abort = new AbortController()
    ctx.on('user-questions/request', async () => {
      abort.abort()
      return { answers: [{ id: 'daedal-host-handoff', selected: ['Start host session'] }] }
    })
    await expect(run(abort.signal)).rejects.toThrow()
    expect(target.create).not.toHaveBeenCalled()
  })

  it('cancels and drains an outstanding human review when the source plugin is unloaded', async () => {
    const target = await destination(); const { ctx, handoffFiber, run } = await source(target.url)
    const asked = Promise.withResolvers<undefined>()
    ctx.on('user-questions/request', async (request) => {
      asked.resolve(undefined)
      return await new Promise((_, reject) => request.signal?.addEventListener('abort',
        () =>{  reject(new Error('review cancelled')) }, { once: true }))
    })
    const outcome = run().catch((error: unknown) => error)
    await asked.promise
    await handoffFiber.dispose()
    expect(await outcome).toBeInstanceOf(Error)
    expect(target.create).not.toHaveBeenCalled()
  })

  it('requires a new confirmation when the source preset changes during review', async () => {
    const target = await destination(); const { ctx, agent, run } = await source(target.url)
    ctx.on('user-questions/request', async () => {
      agent.session.append('agent-preset/selected', { agentPreset: 'daedal-openai' })
      return { answers: [{ id: 'daedal-host-handoff', selected: ['Start host session'] }] }
    })
    await expect(run()).rejects.toThrow('source session changed')
    expect(target.create).not.toHaveBeenCalled()
  })

  it('rejects non-Daedal and runtime-owned child callers at the executor', async () => {
    const target = await destination(); const ordinary = await source(target.url, 'standard')
    await expect(ordinary.run()).rejects.toThrow()
    const { ctx, agent } = await source(target.url)
    const childSession = ctx.sessions.create(SessionId('child'), { meta: { agentPreset: 'daedal' } })
    const child = { id: childSession.id, session: childSession, ctx } as unknown as Agent
    ctx.agents.enter(child, agent)
    await expect(ctx.daedalHandoff.handoff(child, ToolCallId('child-call'), task, signal())).rejects.toThrow('live root')
    expect(target.create).not.toHaveBeenCalled()
  })

  it('uses the current logged preset rather than only the creation header', async () => {
    const target = await destination(); const { ctx, agent, run } = await source(target.url, 'standard')
    agent.session.append('agent-preset/selected', { agentPreset: 'daedal' })
    approve(ctx)
    expect(await run()).toMatchObject({ status: 'started' })
  })

  it('reports uncertain post-dispatch acceptance without retrying', async () => {
    const target = await destination(); const { ctx, run } = await source(target.url)
    approve(ctx)
    target.prompt.mockRejectedValueOnce(new Error('private destination failure'))
    const result = await run()
    expect(result).toMatchObject({ status: 'unknown', sessionId: expect.stringMatching(/^handoff-/) as string })
    expect(JSON.stringify(result)).not.toContain('private destination failure')
    expect(target.create).toHaveBeenCalledTimes(1)
    expect(target.prompt).toHaveBeenCalledTimes(1)
  })

  it('does not globally publish the tool when only the host service is installed', async () => {
    const { ctx } = await source()
    expect(ctx.tools.schemas().map(row => row.name)).not.toContain('handoff_to_host')
    const fiber = ctx.plugin(tool); await fiber
    expect(ctx.tools.schemas().map(row => row.name)).toContain('handoff_to_host')
    expect(renderContextSnapshot(await ctx.systemPrompt.assemble())).toContain('Permission changes cannot move this session onto the host')
    await fiber.dispose()
    expect(ctx.tools.schemas().map(row => row.name)).not.toContain('handoff_to_host')
    expect(renderContextSnapshot(await ctx.systemPrompt.assemble())).not.toContain('Execution environment:')
  })

  it('explains host execution and refuses a redundant host handoff', async () => {
    const { ctx, agent } = await source(undefined, 'daedal', host)
    await ctx.plugin(tool)
    expect(renderContextSnapshot(await ctx.systemPrompt.assemble())).toContain('Execution environment: host')
    const result = await ctx.tools.execute({ name: 'handoff_to_host', arguments: task, agent, callId: ToolCallId('x'), signal: signal() })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('already runs on the host')
  })
})

describe('separate host receiver', () => {
  it('requires authentication and validates destination, mode, input and byte limits before creation', async () => {
    const target = await destination()
    expect((await target.send(undefined, 'wrong')).status).toBe(401)
    expect((await target.send({ ...target.request, preset: 'standard' })).status).toBe(400)
    expect((await target.send({ ...target.request, destination: { name: 'different', cwd: '/' } })).status).toBe(409)
    expect((await target.send('not json')).status).toBe(400)
    expect((await target.send('x'.repeat(8193))).status).toBe(413)
    expect(target.create).not.toHaveBeenCalled()
  })

  it('serializes concurrent identical deliveries with one Session and one prompt admission', async () => {
    const target = await destination()
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    target.create.mockImplementationOnce(async () => { entered.resolve(undefined); await release.promise; return { sessionId: SessionId('unused') } })
    const first = target.send(); await entered.promise
    const validated = Promise.withResolvers<undefined>()
    const parse = requestSchema.safeParse.bind(requestSchema)
    vi.spyOn(requestSchema, 'safeParse').mockImplementationOnce((...args) => {
      const result = parse(...args)
      validated.resolve(undefined)
      return result
    })
    const second = target.send()
    await validated.promise
    release.resolve(undefined)
    const replies = await Promise.all([first, second])
    const bodies = await Promise.all(replies.map(reply => reply.json()))
    expect(bodies).toEqual([
      { sessionId: handoffSessionId(target.request), accepted: true },
      { sessionId: handoffSessionId(target.request), accepted: true },
    ])
    expect(target.create).toHaveBeenCalledTimes(1)
    expect(target.prompt).toHaveBeenCalledTimes(1)
    for (const call of target.create.mock.calls) {
      expect((call as unknown as [{ sessionId: string }])[0].sessionId).toBe(handoffSessionId(target.request))
    }
  })

  it('refuses browser-origin and non-JSON requests before starting work', async () => {
    const target = await destination()
    const endpoint = target.url + HANDOFF_PATH
    expect((await fetch(endpoint, { headers: { authorization: `Bearer ${token}`, origin: target.url } })).status).toBe(401)
    expect((await fetch(endpoint, { method: 'PUT', headers: { authorization: `Bearer ${token}` } })).status).toBe(405)
    expect((await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: 'x' })).status).toBe(415)
    expect(target.create).not.toHaveBeenCalled()
  })

  it('aborts and drains outstanding prompt admission before receiver unload completes', async () => {
    const target = await destination()
    const entered = Promise.withResolvers<undefined>()
    let stopped = false
    target.prompt.mockImplementationOnce(async (_request, abort) => {
      entered.resolve(undefined)
      return await new Promise((_, reject) =>{  abort.addEventListener('abort', () => {
        stopped = true
        reject(new Error('admission cancelled'))
      }, { once: true }) })
    })
    const response = target.send()
    await entered.promise
    await target.fiber.dispose()
    expect(stopped).toBe(true)
    expect((await response).status).toBe(503)
    expect((await target.send(undefined, token, 'GET')).status).toBe(404)
  })

  it('rejects missing authentication and bounds streamed input without a content length', async () => {
    const target = await destination()
    expect((await fetch(target.url + HANDOFF_PATH)).status).toBe(401)
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(target.url + HANDOFF_PATH, { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      }, (res) => { res.resume(); resolve(res.statusCode!) })
      req.on('error', reject)
      req.write('x'.repeat(8193))
      req.end()
    })
    expect(status).toBe(413)
    expect(target.create).not.toHaveBeenCalled()
  })

  it('closes an incomplete request when the receiver unloads', async () => {
    const target = await destination()
    const entered = Promise.withResolvers<undefined>()
    target.seen.mockImplementationOnce(() => { entered.resolve(undefined) })
    const disconnected = Promise.withResolvers<undefined>()
    const req = httpRequest(target.url + HANDOFF_PATH, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': '100' },
    })
    req.once('error', () => { disconnected.resolve(undefined) })
    req.write('{')
    try {
      await entered.promise
      await target.fiber.dispose()
      await disconnected.promise
      expect(target.create).not.toHaveBeenCalled()
    } finally { req.destroy() }
  })

  it('rejects an invalid or non-directory configured destination before mounting', async () => {
    const ctx = context(); world(ctx)
    await expect(receiver.apply(ctx, { name: '', cwd: tmpdir(), token, maxBytes: 8192, timeoutMs: 5000 })).rejects.toThrow('requires a name')
    await expect(receiver.apply(ctx, { name: 'file', cwd: new URL('../package.json', import.meta.url).pathname,
      token, maxBytes: 8192, timeoutMs: 5000 })).rejects.toThrow('must be a directory')
  })

  it('withdraws its route when unloaded', async () => {
    const target = await destination()
    await target.fiber.dispose()
    expect((await target.send(undefined, token, 'GET')).status).toBe(404)
  })

  it('refuses isolated providers even when mounted directly', async () => {
    const ctx = context(); world(ctx, Symbol('container'))
    await expect(receiver.apply(ctx, { name: 'invalid', cwd: tmpdir(), token, maxBytes: 8192, timeoutMs: 5000 })).rejects.toThrow('host filesystem')
  })
})
