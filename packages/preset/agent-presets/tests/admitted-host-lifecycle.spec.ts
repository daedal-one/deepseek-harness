import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { dump } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentPresets, {
  COMPOSITION_FILE, executionContextForAgent, fingerprintSessionPrefix, sessionCompositionSource,
  standingMountFor, type Config, type SessionAdmission, type SessionCompositionSource,
} from '../src/index.ts'
import { createSessionTestRemote } from '../../../api/session-controller/tests/test-remote.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const HOST = '@deepseek-ai/dsh/host-execution-world'
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

function history(id: string, cwd: string, text = 'recorded work'): Session {
  const session = Session.create(SessionId(id), undefined, {
    id: SessionId(id), version: SESSION_FORMAT_VERSION,
    createdAt: 1, cwd, agentPreset: 'standard', isSeeded: false, delegationDepth: 0,
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

function admitSource(source: SessionCompositionSource): SessionAdmission {
  const { header } = source
  return {
    sessionId: header.id, agentPreset: 'standard', createdAt: header.createdAt,
    cwd: header.cwd!, parentSession: header.parentSession ?? null, origin: header.origin ?? null,
    delegationDepth: header.delegationDepth ?? null, isSeeded: header.isSeeded,
    inheritedEventCount: source.inheritedEventCount,
    prefix: fingerprintSessionPrefix(source, source.events.length), compositionPreset: 'host-wrapper',
  }
}

function admit(session: Session): SessionAdmission {
  return admitSource(sessionCompositionSource(session))
}

async function storedSource(ctx: Context, id: SessionId): Promise<SessionCompositionSource> {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    return { header: handle.header, inheritedEventCount: handle.inheritedEventCount, events: (await handle.read()).events }
  } finally {
    await handle.close()
  }
}

async function persist(ctx: Context, session: Session): Promise<void> {
  const handle = await ctx.sessionPersistence.create(session.header, { inheritedEventCount: session.inheritedEventCount })
  try {
    await handle.append(session.snapshotEvents())
    await handle.flush()
  } finally {
    await handle.close()
  }
  const stored = await ctx.sessionPersistence.open(session.id, 'read')
  try {
    expect(stored.header).toEqual(session.header)
  } finally {
    await stored.close()
  }
}

async function boot(
  root: string, entries: readonly SessionAdmission[], responses?: ConstructorParameters<typeof MockAdapter>[0],
) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: '' } })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { group: Group, include: Include, 'fixture-presets': AgentPresets })
  const config: Config = {
    default: 'standard', roots: [{ path: join(root, 'presets'), trust: 'system' }],
    includeShippedRoot: false, includeUserRoot: false, sessionAdmissions: entries,
  }
  const path = join(root, 'cordis.yml')
  await writeFile(path, dump([{ name: 'cordis:fixture-presets', config }]))
  await ctx.plugin(Include, { path: pathToFileURL(path).href })
  ctx.provide('workspaceRegistry', { list: () => [] } as never)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }), cwd: root,
  })
  if (responses !== undefined) {
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    ctx.llm.registerAdapter(['fixture'], new MockAdapter(responses))
  }
  return { ctx, remote }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-admitted-host-lifecycle-'))
  roots.push(root)
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  for (const id of ['standard', 'host-wrapper']) await mkdir(join(root, 'presets', id), { recursive: true })
  const logical = { name: join(FIXTURES, 'plugins/contribute.js'), config: { tool: 'logical-tool' } }
  await writeFile(join(root, 'presets', 'standard', COMPOSITION_FILE), dump([logical]))
  await writeFile(join(root, 'presets', 'host-wrapper', COMPOSITION_FILE), dump([
    logical,
    {
      name: 'cordis:group', group: true, isolate: { fs: true, subprocess: true, shell: true },
      config: [{ name: join(FIXTURES, 'plugins/execution-services.js'), config: {
        services: ['fs', 'subprocess', 'shell'], world: HOST,
      } }],
    },
  ]))
  await writeFile(join(root, 'presets', 'standard', 'access.yml'), 'permissionPreset: original-policy\n')
  await writeFile(join(root, 'presets', 'host-wrapper', 'access.yml'), 'permissionPreset: wrapper-policy\n')
  return { root, cwd }
}

function expectHost(ctx: Context, id: SessionId): void {
  const agent = ctx.agents.get(id)
  expect(agent).toBeDefined()
  if (agent === undefined) return
  expect(standingMountFor(agent.ctx)).toMatchObject({
    logicalPresetId: 'standard', compositionPresetId: 'host-wrapper', variant: 'admitted',
  })
  expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('standard')
  expect(ctx.agentPresets.permissionPresetFor(agent.ctx)).toBe('original-policy')
  expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['logical-tool'])
  expect(executionContextForAgent(ctx, agent).get('fs')?.executionWorld).toBe(Symbol.for(HOST))
}

describe('admitted Session host lifecycle through the Session Controller', () => {
  it('adopts an exact persisted root, reconstructs it in a fresh runtime, and isolates an ordinary root', async () => {
    const { root, cwd } = await fixture()
    const original = history('approved', cwd)
    original.append('permission/preset', { preset: 'read-only' })
    original.append('sandbox/mode', { mode: 'read-only' })
    original.append('approval/policy', { policy: 'never' })
    const first = await boot(root, [admit(original)])
    await persist(first.ctx, original)
    const created = await first.remote.create({ sessionId: original.id, cwd })
    if (!created.ok) throw created.error
    expect(created.value.agentPreset).toBe('standard')
    expectHost(first.ctx, original.id)
    expect(first.ctx.agents.get(original.id)?.session.snapshotEvents().slice(0, original.seq))
      .toEqual(original.snapshotEvents())
    await first.ctx.fiber.dispose()

    const fresh = await boot(root, [admit(original)])
    expect(await fresh.remote.create({ sessionId: original.id, cwd })).toMatchObject({ ok: true })
    expectHost(fresh.ctx, original.id)
    expect(fresh.ctx.agents.get(original.id)?.session.header.agentPreset).toBe('standard')
    const ordinary = await fresh.remote.create({ sessionId: SessionId('ordinary'), cwd })
    expect(ordinary).toMatchObject({ ok: true, value: { agentPreset: 'standard' } })
    const other = fresh.ctx.agents.get(SessionId('ordinary'))!
    expect(standingMountFor(other.ctx)).toMatchObject({ compositionPresetId: 'standard', variant: 'ordinary' })
    expect(fresh.ctx.tools.schemas(other).map(tool => tool.name)).toEqual(['logical-tool'])
    expect(standingMountFor(other.ctx)?.key).not.toBe(standingMountFor(fresh.ctx.agents.get(original.id)!.ctx)?.key)
  })

  it('forks admitted live and cold sources with the logical preset and independent root lineage', async () => {
    const { root, cwd } = await fixture()
    const original = history('fork-source', cwd)
    const first = await boot(root, [admit(original)])
    await persist(first.ctx, original)
    const created = await first.remote.create({ sessionId: original.id, cwd })
    if (!created.ok) throw created.error
    const liveOrigins: (Agent | undefined)[] = []
    first.ctx.on('agent/prepare', ({ origin }) => { liveOrigins.push(origin.parentAgent) })
    const live = await first.remote.forkTo({ sessionId: original.id, childSessionId: SessionId('live-fork') })
    expect(live).toMatchObject({ ok: true })
    expectHost(first.ctx, SessionId('live-fork'))
    const child = first.ctx.agents.get(SessionId('live-fork'))!
    expect(child.session.header).toMatchObject({ parentSession: original.id, cwd, isSeeded: true, agentPreset: 'standard' })
    expect(child.session.header.origin).toBeUndefined()
    const liveSource = first.ctx.agents.get(original.id)!.session.snapshotEvents()
    expect(child.session.inheritedEventCount).toBe(liveSource.length)
    expect(child.session.snapshotEvents().slice(0, liveSource.length)).toEqual(liveSource)
    expect(liveOrigins).toEqual([undefined])
    const liveMount = standingMountFor(child.ctx)!
    expect(liveMount).toBe(standingMountFor(first.ctx.agents.get(original.id)!.ctx))
    await first.ctx.fiber.dispose()

    const fresh = await boot(root, [admit(original)])
    const coldOrigins: (Agent | undefined)[] = []
    fresh.ctx.on('agent/prepare', ({ origin }) => { coldOrigins.push(origin.parentAgent) })
    const cold = await fresh.remote.forkTo({ sessionId: original.id, childSessionId: SessionId('cold-fork') })
    expect(cold).toMatchObject({ ok: true })
    expect(fresh.ctx.agents.get(original.id)).toBeUndefined()
    expectHost(fresh.ctx, SessionId('cold-fork'))
    const coldAgent = fresh.ctx.agents.get(SessionId('cold-fork'))!
    expect(coldAgent.session.header.parentSession).toBe(original.id)
    expect(coldAgent.session.header.origin).toBeUndefined()
    expect(coldOrigins).toEqual([undefined])
    expect(standingMountFor(coldAgent.ctx)?.key).not.toBe(liveMount.key)
    await fresh.ctx.fiber.dispose()

    const withoutOwnAdmission = await boot(root, [admit(original)])
    const resumedFork = await withoutOwnAdmission.remote.create({ sessionId: coldAgent.id, cwd })
    expect(resumedFork).toMatchObject({ ok: false })
    if (!resumedFork.ok) expect(resumedFork.error.message).toMatch(/own session admission/)
    expect(withoutOwnAdmission.ctx.agents.get(coldAgent.id)).toBeUndefined()
  })

  it('forks a live admitted fork through its retained generation despite a newer wrapper', async () => {
    const { root, cwd } = await fixture()
    const original = history('chain-source', cwd)
    const { ctx, remote } = await boot(root, [admit(original)])
    await persist(ctx, original)
    const resumed = await remote.create({ sessionId: original.id, cwd })
    if (!resumed.ok) throw resumed.error
    const first = await remote.forkTo({ sessionId: original.id, childSessionId: SessionId('chain-first') })
    if (!first.ok) throw first.error
    const sourceAgent = ctx.agents.get(SessionId('chain-first'))!
    const generation = standingMountFor(sourceAgent.ctx)!
    const observed = sessionCompositionSource(sourceAgent.session)
    sourceAgent.session.append('session/end-seed', {})
    await writeFile(join(root, 'presets', 'host-wrapper', COMPOSITION_FILE), dump([
      { name: join(FIXTURES, 'plugins/contribute.js'), config: { tool: 'later-tool' } },
      { name: 'cordis:group', group: true, isolate: { fs: true, subprocess: true, shell: true },
        config: [{ name: join(FIXTURES, 'plugins/execution-services.js'),
          config: { services: ['fs', 'subprocess', 'shell'], world: HOST } }] },
    ]))
    const second = await ctx.agents.create({
      sessionId: SessionId('chain-second'), seed: observed.events,
      inheritedEventCount: SessionLogOffset(observed.events.length),
      meta: { cwd, parentSession: sourceAgent.id, agentPreset: 'standard', isSeeded: true },
      setup: async (childCtx, child) => {
        await ctx.agentPresets.composeFromSession(childCtx, child.session, observed)
      },
    })
    expect(standingMountFor(second.agent.ctx)).toBe(generation)
    expect(ctx.agentPresets.permissionPresetFor(second.agent.ctx)).toBe('original-policy')
    expect(ctx.tools.schemas(second.agent).map(tool => tool.name)).toEqual(['logical-tool'])
    const next = await remote.forkTo({ sessionId: sourceAgent.id, childSessionId: SessionId('chain-third') })
    expect(next).toMatchObject({ ok: true })
    expect(standingMountFor(ctx.agents.get(SessionId('chain-third'))!.ctx)).toBe(generation)
    await expect(ctx.agents.create({
      sessionId: SessionId('bad-cwd'), seed: observed.events,
      inheritedEventCount: SessionLogOffset(observed.events.length),
      meta: { cwd: cwd + '/other', parentSession: sourceAgent.id, agentPreset: 'standard', isSeeded: true },
      setup: async (childCtx, child) => {
        await ctx.agentPresets.composeFromSession(childCtx, child.session, observed)
      },
    })).rejects.toThrow(/cwd/)
    const changedObservation = {
      ...observed,
      events: [{ ...observed.events[0]!, time: 99 }, ...observed.events.slice(1)] as SessionCompositionSource['events'],
    }
    await expect(ctx.agents.create({
      sessionId: SessionId('bad-observation'), seed: observed.events,
      inheritedEventCount: SessionLogOffset(observed.events.length),
      meta: { cwd, parentSession: sourceAgent.id, agentPreset: 'standard', isSeeded: true },
      setup: async (childCtx, child) => {
        await ctx.agentPresets.composeFromSession(childCtx, child.session, changedObservation)
      },
    })).rejects.toThrow(/fork inherited prefix differs/)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const resolvePreset = ctx.agentPresets.resolve.bind(ctx.agentPresets)
    vi.spyOn(ctx.agentPresets, 'resolve').mockImplementation(async (id) => {
      if (id === 'standard') {
        entered.resolve(undefined)
        await release.promise
      }
      return resolvePreset(id)
    })
    const pending = ctx.agents.create({
      sessionId: SessionId('raced-source'), seed: observed.events,
      inheritedEventCount: SessionLogOffset(observed.events.length),
      meta: { cwd, parentSession: sourceAgent.id, agentPreset: 'standard', isSeeded: true },
      setup: async (childCtx, child) => {
        await ctx.agentPresets.composeFromSession(childCtx, child.session, observed)
      },
    })
    const rejected = expect(pending).rejects.toThrow(/lost its standing composition/)
    try {
      await entered.promise
      await generation.fiber.dispose()
    } finally {
      release.resolve(undefined)
      await rejected
      vi.restoreAllMocks()
    }
    await expect(ctx.agents.create({
      sessionId: SessionId('disposed-source'), seed: observed.events,
      inheritedEventCount: SessionLogOffset(observed.events.length),
      meta: { cwd, parentSession: sourceAgent.id, agentPreset: 'standard', isSeeded: true },
      setup: async (childCtx, child) => {
        await ctx.agentPresets.composeFromSession(childCtx, child.session, observed)
      },
    })).rejects.toThrow(/live fork source/)
  })

  it.each(['joined', 'preparing', 'persisting'] as const)('vetoes a multihop fork after its admitted generation is disposed while %s', async (phase) => {
    const { root, cwd } = await fixture()
    const original = history('barrier-source', cwd)
    const { ctx } = await boot(root, [admit(original)])
    const parent = await ctx.agents.create({
      sessionId: original.id, seed: original.snapshotEvents(), meta: original.header,
      setup: async (agentCtx, agent) => { await ctx.agentPresets.mount(agentCtx, 'standard', agent.session) },
    })
    const source = sessionCompositionSource(parent.agent.session)
    const first = await ctx.agents.create({
      sessionId: SessionId('barrier-first'), seed: source.events,
      inheritedEventCount: SessionLogOffset(source.events.length),
      meta: { cwd, parentSession: parent.agent.id, agentPreset: 'standard', isSeeded: true },
      setup: async (agentCtx, agent) => { await ctx.agentPresets.composeFromSession(agentCtx, agent.session, source) },
    })
    const observed = sessionCompositionSource(first.agent.session)
    const generation = standingMountFor(first.agent.ctx)!
    const target = SessionId('barrier-second')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const hold = async () => { entered.resolve(undefined); await release.promise }
    let prepared: Agent | undefined
    let preparationSignal: AbortSignal | undefined
    let laterPrepareRan = false
    const created: SessionId[] = []
    ctx.on('agent/created', ({ agent }) => { created.push(agent.id) })
    ctx.on('agent/prepare', async ({ agent, signal }) => {
      if (agent.id !== target) return
      laterPrepareRan = true
      preparationSignal = signal
      if (phase === 'preparing') await hold()
    })
    const createStored = ctx.sessionPersistence.create.bind(ctx.sessionPersistence)
    vi.spyOn(ctx.sessionPersistence, 'create').mockImplementation(async (header, options) => {
      const handle = await createStored(header, options)
      if (header.id === target && phase === 'persisting') {
        const append = handle.append.bind(handle)
        vi.spyOn(handle, 'append').mockImplementation(async (events) => {
          await append(events)
          await hold()
        })
      }
      return handle
    })
    const pending = ctx.agents.create({
      sessionId: target, seed: observed.events,
      inheritedEventCount: SessionLogOffset(observed.events.length),
      meta: { cwd, parentSession: first.agent.id, agentPreset: 'standard', isSeeded: true, delegationDepth: 0 },
      setup: async (agentCtx, agent) => {
        await ctx.agentPresets.composeFromSession(agentCtx, agent.session, observed)
        prepared = agent
        if (phase === 'joined') await hold()
      },
    })
    const rejected = expect(pending.then(() => undefined)).rejects.toThrow(
      phase === 'joined' ? /admitted composition before preparation/ : /admitted composition before publication/,
    )
    try {
      await entered.promise
      expect(prepared).toBeDefined()
      expect(ctx.agentPresets.requiresSessionAdmission(sessionCompositionSource(prepared!.session))).toBe(false)
      expect(standingMountFor(prepared!.ctx)).toBe(generation)
      expect(laterPrepareRan).toBe(phase !== 'joined')
      expect(ctx.agents.get(target)).toBeUndefined()
      await generation.fiber.dispose()
      expect(preparationSignal?.aborted).not.toBe(true)
    } finally {
      release.resolve(undefined)
      await rejected
      vi.restoreAllMocks()
    }
    expect(created).toEqual([])
    expect(ctx.agents.get(target)).toBeUndefined()
    expect(ctx.sessions.get(target)).toBeUndefined()
    expect(() => executionContextForAgent(ctx, first.agent)).toThrow(/admitted composition/)
    expect(parent.agent.session.header).toEqual(original.header)
    expect(parent.agent.session.snapshotEvents().slice(0, original.seq)).toEqual(original.snapshotEvents())
    if (phase === 'persisting') {
      const stored = await storedSource(ctx, target)
      expect(stored.header).toEqual(prepared!.session.header)
      expect(stored.events).toEqual(prepared!.session.snapshotEvents())
    }
  })

  it('refuses a changed persisted source before creating a fork or publishing an admitted root', async () => {
    const { root, cwd } = await fixture()
    const original = history('tampered', cwd)
    const altered = history('tampered', cwd, 'different recorded work')
    const { ctx, remote } = await boot(root, [admit(original)])
    await persist(ctx, altered)
    const fork = await remote.forkTo({ sessionId: original.id, childSessionId: SessionId('rejected-fork') })
    expect(fork).toMatchObject({ ok: false })
    if (!fork.ok) expect(fork.error.message).toMatch(/prefix digest mismatch/)
    const resume = await remote.create({ sessionId: original.id, cwd })
    expect(resume).toMatchObject({ ok: false })
    if (!resume.ok) expect(resume.error.message).toMatch(/prefix digest mismatch/)
    expect(ctx.agents.get(original.id)).toBeUndefined()
    expect(ctx.agents.get(SessionId('rejected-fork'))).toBeUndefined()
    await expect(ctx.agents.create({
      sessionId: SessionId('changed-seed'), seed: altered.snapshotEvents(),
      inheritedEventCount: altered.seq,
      meta: { cwd, parentSession: original.id, agentPreset: 'standard', isSeeded: true },
      setup: async (childCtx, child) => {
        await ctx.agentPresets.composeFromSession(childCtx, child.session, sessionCompositionSource(original))
      },
    })).rejects.toThrow(/fork inherited prefix differs/)
    expect(ctx.agents.get(SessionId('changed-seed'))).toBeUndefined()
  })

  it('requires the continuable child’s own persisted admission on fresh-runtime delivery', { timeout: 20_000 }, async () => {
    const { root, cwd } = await fixture()
    const original = history('delegating-root', cwd)
    const first = await boot(root, [admit(original)], [textResponse('first child'), textResponse('one shot')])
    await persist(first.ctx, original)
    const adopted = await first.remote.create({ sessionId: original.id, cwd })
    if (!adopted.ok) throw adopted.error
    const parent = first.ctx.agents.get(original.id)!
    const started = await first.ctx.subagents.startContinuable({
      provider: 'spawn', label: 'recorded child',
      request: {
        parent, prompt: [{ type: 'text', text: 'recorded child work' }],
        toolFilter: { deny: ['logical-tool'] },
      },
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => { expect(first.ctx.agents.get(started.childId)).toBeUndefined() })
    const storedChild = await storedSource(first.ctx, started.childId)
    const descriptor = storedChild.events.find(event => event.type === 'subagent/descriptor')
    expect(descriptor?.data).toMatchObject({
      mode: 'continuable', provider: 'spawn', label: 'recorded child',
      toolFilter: { deny: ['logical-tool'] },
    })
    expect(storedChild.header).toMatchObject({ parentSession: original.id, origin: 'subagent', agentPreset: 'standard' })
    const oneShot = await first.ctx.subagents.start('spawn', {
      parent, label: 'one shot', prompt: [{ type: 'text', text: 'one shot work' }],
      signal: new AbortController().signal,
    })
    await oneShot.result
    await first.ctx.sessions.flush(oneShot.localAgent!.session)
    await oneShot.dispose()
    const oneShotId = oneShot.id
    const storedOneShot = await storedSource(first.ctx, oneShotId)
    expect(storedOneShot.events.find(event => event.type === 'subagent/descriptor')?.data)
      .toMatchObject({ mode: 'one-shot' })
    await first.ctx.fiber.dispose()

    const missing = await boot(root, [admit(original)], [])
    const missingParent = await missing.remote.create({ sessionId: original.id, cwd })
    if (!missingParent.ok) throw missingParent.error
    const refusal: unknown = await queueHostSubagentPrompt(
      missing.ctx.subagents, missing.ctx.agents.get(original.id)!, started.childId,
      [{ type: 'text', text: 'continue' }], { kind: 'user' }, new AbortController().signal,
    ).catch((error: unknown) => error)
    expect(refusal).toMatchObject({ code: 'NOT_RESUMABLE' })
    expect(refusal instanceof Error && refusal.cause instanceof Error ? refusal.cause.message : '')
      .toMatch(/own session admission/)
    expect(missing.ctx.agents.get(started.childId)).toBeUndefined()
    await missing.ctx.fiber.dispose()

    const fresh = await boot(root, [admit(original), admitSource(storedChild), admitSource(storedOneShot)], [textResponse('resumed child')])
    const resumedParent = await fresh.remote.create({ sessionId: original.id, cwd })
    if (!resumedParent.ok) throw resumedParent.error
    const genericChild = await fresh.remote.create({ sessionId: started.childId, cwd })
    expect(genericChild).toMatchObject({ ok: false, error: { code: 'session/agent-busy' } })
    const genericOneShot = await fresh.remote.create({ sessionId: oneShotId, cwd })
    expect(genericOneShot).toMatchObject({ ok: false, error: { code: 'session/agent-busy' } })
    await expect(queueHostSubagentPrompt(
      fresh.ctx.subagents, fresh.ctx.agents.get(original.id)!, oneShotId,
      [{ type: 'text', text: 'cannot promote' }], { kind: 'user' }, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'NOT_RESUMABLE' })
    let reconstructed: Agent | undefined
    let reconstructedTools: string[] | undefined
    fresh.ctx.on('agent/created', ({ agent }) => {
      if (agent.id === started.childId) {
        reconstructed = agent
        reconstructedTools = fresh.ctx.tools.schemas(agent).map(tool => tool.name)
      }
    })
    await queueHostSubagentPrompt(
      fresh.ctx.subagents, fresh.ctx.agents.get(original.id)!, started.childId,
      [{ type: 'text', text: 'continue' }], { kind: 'user' }, new AbortController().signal,
    )
    await vi.waitFor(() => { expect(fresh.ctx.agents.get(started.childId)).toBeUndefined() })
    expect(reconstructed).toBeDefined()
    expect(reconstructed?.session.header.agentPreset).toBe('standard')
    expect(standingMountFor(reconstructed!.ctx)).toBe(standingMountFor(fresh.ctx.agents.get(original.id)!.ctx))
    expect(reconstructedTools).toEqual([])
    const after = await storedSource(fresh.ctx, started.childId)
    expect(after.events.find(event => event.type === 'subagent/descriptor')).toEqual(descriptor)
    expect(after.events.length).toBeGreaterThan(storedChild.events.length)
  })
})
