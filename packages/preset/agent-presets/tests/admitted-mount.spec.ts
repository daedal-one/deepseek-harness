import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId, SessionLogOffset, SessionSeq, type SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as ToolBash from '../../../shell/tool-bash/src/index.ts'
import { createScope, scopeParentOf, scopeOf } from '@deepseek-ai/dsh-scope'
import { dump } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentPresets, {
  COMPOSITION_FILE, executionContextForAgent, fingerprintSessionPrefix, livePresetMounts,
  sessionCompositionSource, standingMountFor,
  type Config, type SessionAdmission, type SessionCompositionSource,
} from '@deepseek-ai/dsh-agent-presets'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const HOST = '@deepseek-ai/dsh/host-execution-world'
const CWD = resolve(tmpdir(), 'admission-workspace')
const contexts: Context[] = []
const roots: string[] = []

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(1) })
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function source(id = 'legacy', fields: Partial<SessionHeader> = {}): SessionCompositionSource {
  return {
    header: { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, cwd: CWD, agentPreset: 'standard', isSeeded: false, ...fields },
    inheritedEventCount: SessionLogOffset(0),
    events: [{ type: 'session/end-seed', seq: SessionSeq(0), time: 2, data: {} }],
  }
}

function admission(input = source(), target = 'host-wrapper'): SessionAdmission {
  return {
    sessionId: input.header.id, agentPreset: input.header.agentPreset!, createdAt: input.header.createdAt, cwd: input.header.cwd!,
    parentSession: input.header.parentSession ?? null, origin: input.header.origin ?? null,
    delegationDepth: input.header.delegationDepth ?? null,
    isSeeded: input.header.isSeeded, inheritedEventCount: input.inheritedEventCount,
    prefix: fingerprintSessionPrefix(input, input.events.length), compositionPreset: target,
  }
}

function contribution(tool = 'logical-tool'): object {
  return { id: tool, name: join(FIXTURES, 'plugins/contribute.js'), config: { tool } }
}

function execution(world: string, services = ['fs', 'subprocess', 'shell']): object {
  return {
    id: world === HOST ? 'host-execution' : 'other-execution', name: 'cordis:group', group: true,
    isolate: { fs: true, subprocess: true, shell: true },
    config: [{ name: join(FIXTURES, 'plugins/execution-services.js'), config: { services, world } }],
  }
}

function bashConsumer(): object {
  return { id: 'bash-consumer', name: 'cordis:fixture-bash', config: { enableRunInBackground: false } }
}

async function harness(entries: readonly SessionAdmission[] | null = [admission()], trust: 'system' | 'user' = 'system'): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-admitted-preset-'))
  roots.push(root)
  for (const [id, rows] of [
    ['standard', [contribution()]],
    ['host-wrapper', [contribution(), execution(HOST)]],
    ['unique-host', [contribution(), execution(HOST)]],
  ] as const) {
    await mkdir(join(root, id))
    await writeFile(join(root, id, COMPOSITION_FILE), dump(rows))
  }
  await writeFile(join(root, 'standard', 'access.yml'), 'permissionPreset: original-policy\n')
  await writeFile(join(root, 'host-wrapper', 'access.yml'), 'permissionPreset: wrapper-policy\n')
  const config: Config = { default: 'standard', roots: [{ path: root, trust }], includeShippedRoot: false, includeUserRoot: false, ...(entries === null ? {} : { sessionAdmissions: entries }) }
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.provide('shellEnv', {} as never)
  Object.assign(ctx.loader.builtins, {
    group: Group, include: Include, 'fixture-bash': ToolBash, 'fixture-llm': LlmRuntime, 'fixture-sessions': SessionStore,
    'fixture-projections': SessionProjectionRegistry, 'fixture-prompt': SystemPrompt,
    'fixture-tools': ToolRuntime, 'fixture-agents': AgentRegistry, 'fixture-loop': AgentLoop, 'fixture-presets': AgentPresets,
  })
  const path = join(root, 'cordis.yml')
  await writeFile(path, dump([
    { name: 'cordis:fixture-llm' }, { name: 'cordis:fixture-sessions' }, { name: 'cordis:fixture-projections' },
    { name: 'cordis:fixture-prompt', config: { personaPrefix: '' } }, { name: 'cordis:fixture-tools' },
    { name: 'cordis:fixture-agents' }, { name: 'cordis:fixture-loop', config: { agents: [] } },
    { name: join(FIXTURES, 'plugins/execution-services.js'), config: { services: ['fs', 'subprocess', 'shell'], world: 'container' } },
    { name: 'cordis:fixture-presets', config },
  ]))
  await ctx.plugin(Include, { path: pathToFileURL(path).href })
  return { ctx, root }
}

async function agentOn(ctx: Context, input = source(), admitted = true): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: input.header.id,
    meta: { ...input.header },
    seed: input.events,
    setup: async (agentCtx, agent) => {
      const preset = await ctx.agentPresets.mount(agentCtx, input.header.agentPreset, admitted ? agent.session : undefined)
      expect(preset.id).toBe(input.header.agentPreset)
    },
  })
  return handle.agent
}

async function childOf(ctx: Context, parent: Agent, input: SessionCompositionSource, kind: 'create' | 'resume', withSeed = false): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: input.header.id,
    meta: { ...input.header },
    ...(withSeed ? { seed: input.events } : {}),
    setup: (childCtx, child) => { ctx.agentPresets.composeFrom(childCtx, parent, { session: child.session, source: kind }) },
  })
  return handle.agent
}

describe('admitted standing composition', () => {
  it.each([true, false])('separates admitted and ordinary caches, admitted first=%s', async (admittedFirst) => {
    const { ctx } = await harness()
    const admitted = source()
    const ordinary = source('ordinary')
    const first = await agentOn(ctx, admittedFirst ? admitted : ordinary, admittedFirst)
    const second = await agentOn(ctx, admittedFirst ? ordinary : admitted, !admittedFirst)
    const host = admittedFirst ? first : second
    const container = admittedFirst ? second : first
    expect(ctx.agentPresets.composedPreset(host.ctx)).toBe('standard')
    expect(ctx.agentPresets.composedPreset(container.ctx)).toBe('standard')
    expect(standingMountFor(host.ctx)).toMatchObject({ logicalPresetId: 'standard', compositionPresetId: 'host-wrapper', presetId: 'host-wrapper', variant: 'admitted' })
    expect(standingMountFor(container.ctx)).toMatchObject({ logicalPresetId: 'standard', compositionPresetId: 'standard', variant: 'ordinary' })
    expect(executionContextForAgent(ctx, host).get('fs')?.executionWorld).toBe(Symbol.for(HOST))
    expect(executionContextForAgent(ctx, container).get('fs')?.executionWorld).toBe(Symbol.for('container'))
    expect(ctx.agentPresets.permissionPresetFor(host.ctx)).toBe('original-policy')
    expect(host.session.snapshotEvents()).toEqual(admitted.events)
    expect(ctx.tools.schemas(host)).toEqual(ctx.tools.schemas(container))
    const rows = (await ctx.agentPresets.compositionInventory()).find(preset => preset.id === 'standard')!.rows
    expect(rows.map(row => row.entryId)).toEqual([expect.stringMatching(/:logical-tool$/)])
    expect(await ctx.agentPresets.standingKeyFor('standard')).toBe(standingMountFor(container.ctx)!.key)
    expect(await ctx.agentPresets.standingKeyForSession(admitted)).toBe(standingMountFor(host.ctx)!.key)
  })

  it('rejects publication when setup omitted the Session for a configured admission', async () => {
    const { ctx } = await harness()
    await expect(agentOn(ctx, source(), false)).rejects.toThrow(/requires its admitted composition before preparation/)
    expect(ctx.agents.get(source().header.id)).toBeUndefined()
  })

  it('does not reread mutable manifest objects after configuration resolution', async () => {
    const { ctx } = await harness()
    Object.assign(ctx.agentPresets.config.sessionAdmissions![0]!, { compositionPreset: 'unique-host' })
    const parent = await agentOn(ctx)
    expect(standingMountFor(parent.ctx)?.compositionPresetId).toBe('host-wrapper')
  })

  it('does not expose an admitted generation as an ordinary target inventory', async () => {
    const { ctx, root } = await harness()
    await ctx.agentPresets.standingKeyForSession(source())
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([contribution('file-generation')]))
    const rows = (await ctx.agentPresets.compositionInventory()).find(preset => preset.id === 'host-wrapper')!.rows
    expect(rows.map(row => row.entryId)).toEqual(['file-generation'])
  })

  it('keeps the ordinary cache after an admitted mount failure and retries the fixed wrapper', async () => {
    const { ctx, root } = await harness()
    const ordinary = await ctx.agentPresets.standingKeyFor('standard')
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([contribution(), execution('container')]))
    await expect(ctx.agentPresets.standingKeyForSession(source())).rejects.toThrow(/host/)
    expect(await ctx.agentPresets.standingKeyFor('standard')).toBe(ordinary)
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([contribution(), execution(HOST)]))
    expect(await ctx.agentPresets.standingKeyForSession(source())).not.toBe(ordinary)
  })

  it('rechecks cached effective providers before admitting another reader', async () => {
    const { ctx } = await harness()
    const parent = await agentOn(ctx)
    const execution = executionContextForAgent(ctx, parent)
    Object.assign(execution.get('fs')!, { executionWorld: Symbol.for('container') })
    expect(() => executionContextForAgent(ctx, parent)).toThrow(/host/)
    await expect(ctx.agentPresets.standingKeyForSession(source())).rejects.toThrow(/host/)
  })

  it('does not reopen recomposition or child binding when an admitted subtree is disposed', async () => {
    const { ctx } = await harness()
    const parent = await agentOn(ctx)
    await standingMountFor(parent.ctx)!.fiber.dispose()
    await expect(ctx.agentPresets.recompose(parent.ctx, 'unique-host')).rejects.toThrow(/cannot be recomposed/)
    await expect(childOf(ctx, parent, source('child', { parentSession: parent.id }), 'create')).rejects.toThrow(/live parent composition/)
  })

  it('refuses inherited execution after admission disposal but keeps ordinary bare Agents legal', async () => {
    const { ctx } = await harness()
    const bare = await ctx.agents.create({ sessionId: SessionId('sdk-bare') })
    expect(executionContextForAgent(ctx, bare.agent)).toBe(ctx)
    const parent = await agentOn(ctx)
    const child = await childOf(ctx, parent, source('first', { parentSession: parent.id }), 'create')
    const grandchild = await childOf(ctx, child, source('second', { parentSession: child.id }), 'create')
    expect(ctx.agentPresets.requiresSessionAdmission(sessionCompositionSource(grandchild.session))).toBe(false)
    const generation = standingMountFor(parent.ctx)!
    expect(standingMountFor(grandchild.ctx)).toBe(generation)
    await generation.fiber.dispose()
    for (const agent of [parent, child, grandchild]) {
      expect(() => executionContextForAgent(ctx, agent)).toThrow(/admitted composition/)
      expect(() => executionContextForAgent(ctx, { ctx: agent.ctx })).toThrow(/admitted composition/)
    }
    expect(executionContextForAgent(ctx, bare.agent)).toBe(ctx)
    const rejectedChild = createScope(ctx, {})
    const input = source('rejected-child', { parentSession: grandchild.id })
    const session = Session.create(input.header.id, input.events, input.header)
    expect(() => ctx.agentPresets.composeFrom(rejectedChild.ctx, grandchild, { session, source: 'create' }))
      .toThrow(/live parent composition/)
    expect(scopeParentOf(scopeOf(rejectedChild.ctx)!)).toBeUndefined()
    expect(ctx.agentPresets.permissionPresetFor(rejectedChild.ctx)).toBeUndefined()
    expect(executionContextForAgent(ctx, { ctx: rejectedChild.ctx })).toBe(ctx)
    await expect(ctx.agentPresets.recompose(rejectedChild.ctx, 'standard')).resolves.toMatchObject({ id: 'standard' })
  })

  it('refuses execution fallback for a source that requires admission even before a join', async () => {
    const { ctx } = await harness()
    const input = source()
    const scope = createScope(ctx, {})
    const session = Session.create(input.header.id, input.events, input.header)
    expect(() => executionContextForAgent(ctx, { ctx: scope.ctx, session })).toThrow(/admitted composition/)
    expect(scopeParentOf(scopeOf(scope.ctx)!)).toBeUndefined()
  })

  it('keeps a fresh ordinary generation after preparation records its host context', async () => {
    const { ctx } = await harness()
    ctx.on('agent/prepare', ({ agent }) => {
      agent.session.append('permission/context', { environment: 'host', defaultPreset: 'original-policy' })
    })
    const agent = await agentOn(ctx, source('ordinary'))
    expect(ctx.agentPresets.requiresSessionAdmission(sessionCompositionSource(agent.session))).toBe(true)
    expect(ctx.agentPresets.hasAgentAdmission(agent.ctx)).toBe(false)
    expect(standingMountFor(agent.ctx)?.variant).toBe('ordinary')
    expect(executionContextForAgent(ctx, agent)).toBe(ctx)
    await standingMountFor(agent.ctx)!.fiber.dispose()
    expect(() => executionContextForAgent(ctx, agent)).toThrow(/admitted composition/)
  })

  it.each(['before', 'after'] as const)('fences disposal %s the synchronous publication validation', async (order) => {
    const { ctx } = await harness()
    let disposal: Promise<unknown> = Promise.resolve()
    ctx.on('agent/created', ({ agent }) => {
      disposal = Promise.resolve(standingMountFor(agent.ctx)!.fiber.dispose())
    }, { prepend: order === 'before' })
    try {
      if (order === 'before') {
        await expect(agentOn(ctx).then(() => undefined)).rejects.toThrow(/admitted composition before publication/)
        expect(ctx.agents.get(source().header.id)).toBeUndefined()
      } else {
        const agent = await agentOn(ctx)
        expect(ctx.agents.get(agent.id)).toBe(agent)
        expect(() => executionContextForAgent(ctx, agent)).toThrow(/admitted composition/)
      }
    } finally {
      await disposal
    }
  })

  it('rejects an ordinary recompose that resolves after the scope joins admission', async () => {
    const { ctx } = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = ctx.agentPresets.resolve.bind(ctx.agentPresets)
    vi.spyOn(ctx.agentPresets, 'resolve').mockImplementation(async (id) => {
      if (id === 'unique-host') {
        entered.resolve(undefined)
        await release.promise
      }
      return original(id)
    })
    const scope = createScope(ctx, {})
    const pending = ctx.agentPresets.recompose(scope.ctx, 'unique-host')
    const rejected = expect(pending).rejects.toThrow(/cannot be recomposed/)
    try {
      await entered.promise
      await ctx.agentPresets.mount(scope.ctx, 'standard', Session.create(source().header.id, source().events, source().header))
    } finally {
      release.resolve(undefined)
      await rejected
    }
    expect(standingMountFor(scope.ctx)?.variant).toBe('admitted')
  })

  it('uses empty admissions when configuration omits them', async () => {
    const { ctx } = await harness(null)
    expect(ctx.agentPresets.config.sessionAdmissions).toEqual([])
    expect(standingMountFor((await agentOn(ctx)).ctx)?.variant).toBe('ordinary')
    const parsed = AgentPresets.Config({ default: 'standard', roots: [], includeShippedRoot: false, includeUserRoot: false })
    expect(parsed.sessionAdmissions).toEqual([])
  })

  it('validates history before reading even a successfully cached admitted composition', async () => {
    const { ctx } = await harness()
    const key = await ctx.agentPresets.standingKeyForSession(source())
    const resolvePreset = vi.spyOn(ctx.agentPresets, 'resolve')
    const invalid = { ...source(), events: [] }
    await expect(ctx.agentPresets.standingKeyForSession(invalid)).rejects.toThrow(/truncated/)
    expect(resolvePreset).not.toHaveBeenCalled()
    const scope = createScope(ctx, {})
    const empty = Session.create(source().header.id, undefined, source().header)
    await expect(ctx.agentPresets.mount(scope.ctx, 'standard', empty)).rejects.toThrow(/truncated/)
    expect(resolvePreset).not.toHaveBeenCalled()
    const agent = await agentOn(ctx, source('other'))
    await expect(ctx.agentPresets.mount(scope.ctx, 'minimal', agent.session)).rejects.toThrow(/not found/)
    await expect(ctx.agentPresets.mount(scope.ctx, 'unique-host', (await agentOn(ctx)).session)).rejects.toThrow(/requested logical preset/)
    expect(scopeParentOf(scopeOf(scope.ctx)!)).toBeUndefined()
    expect(await ctx.agentPresets.standingKeyForSession(source())).toBe(key)
  })

  it('rejects duplicate or malformed admission configuration during plugin loading', async () => {
    await expect(harness([admission(), admission()])).rejects.toThrow(/duplicate session admission/)
    const malformed = { ...admission(), parentSession: undefined } as unknown as SessionAdmission
    await expect(harness([malformed])).rejects.toThrow(/parentSession/)
  })

  it.each(['user', 'missing', 'broken', 'throws'] as const)('rejects a %s execution target', async (kind) => {
    const { ctx, root } = await harness([admission()], kind === 'user' ? 'user' : 'system')
    if (kind === 'missing') await rm(join(root, 'host-wrapper'), { recursive: true })
    if (kind === 'broken') await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), 'not: a-list\n')
    if (kind === 'throws') await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([{ name: join(FIXTURES, 'plugins/throws.js'), config: { message: 'refused wrapper' } }]))
    await expect(agentOn(ctx)).rejects.toThrow(kind === 'user' ? /system trust/ : kind === 'missing' ? /not found/ : /failed to mount/)
    expect(ctx.agents.get(SessionId('legacy'))).toBeUndefined()
    expect(livePresetMounts(ctx.fiber)).toHaveLength(0)
  })

  it.each(['container', 'no-shell', 'auxiliary-host', 'shell-mismatch', 'missing-fs', 'missing-subprocess'])('rejects actual world %s before publication', async (kind) => {
    const { ctx, root } = await harness()
    let rows: object[]
    if (kind === 'shell-mismatch') {
      rows = [{
        name: 'cordis:group', group: true, isolate: { fs: true, subprocess: true, shell: true },
        config: [
          { name: join(FIXTURES, 'plugins/execution-services.js'), config: { services: ['fs', 'subprocess'], world: HOST } },
          { name: join(FIXTURES, 'plugins/execution-services.js'), config: { services: ['shell'], world: 'container' } },
        ],
      }]
    } else if (kind === 'auxiliary-host') rows = [execution(HOST, ['fs', 'subprocess']), execution('container')]
    else rows = [execution(kind === 'container' ? 'container' : HOST, ['fs', 'subprocess', 'shell'].filter(name =>
      kind !== 'no-shell' || name !== 'shell').filter(name => kind !== 'missing-fs' || name !== 'fs').filter(name => kind !== 'missing-subprocess' || name !== 'subprocess'))]
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([contribution(), ...rows]))
    await expect(agentOn(ctx)).rejects.toThrow(/host/)
    expect(ctx.agents.get(SessionId('legacy'))).toBeUndefined()
    expect(livePresetMounts(ctx.fiber)).toHaveLength(0)
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('refuses a disconnected host shell beside a real bash consumer bound to the root container', async () => {
    const { ctx, root } = await harness()
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([
      contribution(), execution(HOST), bashConsumer(),
    ]))
    await expect(agentOn(ctx)).rejects.toThrow(/host/)
    expect(ctx.agents.get(SessionId('legacy'))).toBeUndefined()
    expect(livePresetMounts(ctx.fiber)).toHaveLength(0)
    const ordinary = await agentOn(ctx, source('ordinary', { agentPreset: 'host-wrapper' }), false)
    expect(ctx.tools.schemas(ordinary).map(schema => schema.name)).toContain('bash')
    expect(executionContextForAgent(ctx, ordinary).get('fs')?.executionWorld).toBe(Symbol.for('container'))
    expect(executionContextForAgent(ctx, ordinary).get('shell')?.executionWorld).toBe(Symbol.for('container'))
  })

  it('refuses multiple isolated shells without a consumer to select one', async () => {
    const { ctx, root } = await harness()
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([
      contribution(), execution(HOST), execution('container'),
    ]))
    await expect(agentOn(ctx)).rejects.toThrow(/ambiguous shell providers/)
    expect(ctx.agents.get(SessionId('legacy'))).toBeUndefined()
    expect(livePresetMounts(ctx.fiber)).toHaveLength(0)
  })

  it('follows a real bash consumer enclosed in the host group despite other shells', async () => {
    const { ctx, root } = await harness()
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([
      contribution(), execution('container'),
      {
        id: 'host-execution', name: 'cordis:group', group: true,
        isolate: { fs: true, subprocess: true, shell: true },
        config: [
          { name: join(FIXTURES, 'plugins/execution-services.js'), config: { services: ['fs', 'subprocess', 'shell'], world: HOST } },
          bashConsumer(),
        ],
      },
    ]))
    const agent = await agentOn(ctx)
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toContain('bash')
    expect(executionContextForAgent(ctx, agent).get('fs')?.executionWorld).toBe(Symbol.for(HOST))
    expect(standingMountFor(agent.ctx)?.variant).toBe('admitted')
  })

  it('accepts a shell without a published world when its effective dependencies are host', async () => {
    const { ctx, root } = await harness()
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([
      contribution(),
      {
        name: 'cordis:group', group: true, isolate: { fs: true, subprocess: true, shell: true },
        config: [
          { name: join(FIXTURES, 'plugins/execution-services.js'), config: { services: ['fs', 'subprocess'], world: HOST } },
          { name: join(FIXTURES, 'plugins/execution-services.js'), config: { services: ['shell'], world: null } },
        ],
      },
    ]))
    const agent = await agentOn(ctx)
    expect(executionContextForAgent(ctx, agent).get('shell')?.executionWorld).toBeUndefined()
    expect(standingMountFor(agent.ctx)?.variant).toBe('admitted')
  })

  it('does not validate or apply the wrapper permission default and refuses recompose', async () => {
    const { ctx } = await harness()
    const validated: string[] = []
    ctx.on('agent-preset/validating', (preset) => { validated.push(preset.permissionPreset!) })
    const agent = await agentOn(ctx)
    expect(validated).toEqual(['original-policy'])
    await expect(ctx.agentPresets.recompose(agent.ctx, 'unique-host')).rejects.toThrow(/cannot be recomposed/)
    await expect(ctx.agentPresets.select(agent, 'unique-host')).rejects.toThrow(/cannot be recomposed/)
    expect(agent.session.snapshotEvents()).toEqual(source().events)
  })

  it('refreshes and disposes only the admitted variant, retaining the ordinary generation', async () => {
    const { ctx, root } = await harness()
    const ordinary = await ctx.agentPresets.standingKeyFor('standard')
    const first = await ctx.agentPresets.standingKeyForSession(source())
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([contribution('changed-generation'), execution(HOST)]))
    const [next, shared] = await Promise.all([
      ctx.agentPresets.standingKeyForSession(source()), ctx.agentPresets.standingKeyForSession(source()),
    ])
    expect(next).not.toBe(first)
    expect(shared).toBe(next)
    expect(await ctx.agentPresets.standingKeyFor('standard')).toBe(ordinary)
    const mounted = livePresetMounts(ctx.fiber).find(mount => mount.key === next)!
    await mounted.fiber.dispose()
    expect(await ctx.agentPresets.standingKeyForSession(source())).not.toBe(next)
    expect(await ctx.agentPresets.standingKeyFor('standard')).toBe(ordinary)
  })
})

describe('child composition joins', () => {
  const childSource = (id = 'child'): SessionCompositionSource => source(id, { parentSession: SessionId('legacy'), origin: 'subagent', delegationDepth: 1 })

  it('inherits the exact admitted generation and permission default without cold inheritance', async () => {
    const { ctx, root } = await harness()
    const parent = await agentOn(ctx)
    const generation = standingMountFor(parent.ctx)!
    await writeFile(join(root, 'host-wrapper', COMPOSITION_FILE), dump([contribution('later-generation'), execution(HOST)]))
    expect(await ctx.agentPresets.standingKeyForSession(source())).not.toBe(generation.key)
    const child = await childOf(ctx, parent, childSource(), 'create')
    expect(standingMountFor(child.ctx)).toBe(generation)
    expect(ctx.agentPresets.composedPreset(child.ctx)).toBe('standard')
    expect(ctx.agentPresets.permissionPresetFor(child.ctx)).toBe('original-policy')
    await expect(ctx.agentPresets.standingKeyForSession(sessionCompositionSource(child.session)))
      .rejects.toThrow(/own session admission/)
    await expect(childOf(ctx, parent, childSource('unlisted-resume'), 'resume', true)).rejects.toThrow(/own session admission/)
  })

  it('refuses unlisted direct and multihop host histories but keeps ordinary unique-host roots', async () => {
    const { ctx } = await harness()
    const direct = childSource('unlisted-direct')
    const hostContext = (input: SessionCompositionSource, environment: 'host' | 'container'): SessionCompositionSource => ({
      ...input,
      events: [...input.events, { type: 'permission/context', seq: SessionSeq(input.events.length), time: 3,
        data: { environment, defaultPreset: 'original-policy' } }] as SessionCompositionSource['events'],
    })
    const multihop = hostContext(source('multihop', { parentSession: SessionId('unlisted-direct') }), 'host')
    expect(ctx.agentPresets.requiresSessionAdmission(direct)).toBe(true)
    expect(ctx.agentPresets.requiresSessionAdmission(multihop)).toBe(true)
    await expect(ctx.agentPresets.standingKeyForSession(direct)).rejects.toThrow(/own session admission/)
    await expect(ctx.agentPresets.standingKeyForSession(multihop)).rejects.toThrow(/own session admission/)
    const ordinary = hostContext(source('ordinary-root'), 'container')
    expect(ctx.agentPresets.requiresSessionAdmission(ordinary)).toBe(false)
    expect(await ctx.agentPresets.standingKeyForSession(ordinary)).toBe(await ctx.agentPresets.standingKeyFor('standard'))
    const unique = hostContext(source('unique-root', { agentPreset: 'unique-host' }), 'host')
    expect(ctx.agentPresets.requiresSessionAdmission(unique)).toBe(false)
    expect(await ctx.agentPresets.standingKeyForSession(unique)).toBe(await ctx.agentPresets.standingKeyFor('unique-host'))
    const latestContainer = hostContext(multihop, 'container')
    expect(ctx.agentPresets.requiresSessionAdmission(latestContainer)).toBe(false)
  })

  it('requires a resumed child admission to match the parent actual variant', async () => {
    const { ctx } = await harness([admission(), admission(childSource()), admission(childSource('conflict'), 'unique-host')])
    const parent = await agentOn(ctx)
    const child = await childOf(ctx, parent, childSource(), 'resume', true)
    expect(standingMountFor(child.ctx)).toBe(standingMountFor(parent.ctx))
    await expect(childOf(ctx, parent, childSource('conflict'), 'resume', true)).rejects.toThrow(/conflicts/)
    expect(ctx.agents.get(SessionId('conflict'))).toBeUndefined()
  })

  it('restores cold host composition only with the child’s exact admission', async () => {
    const { ctx } = await harness([admission(), admission(childSource())])
    const key = await ctx.agentPresets.standingKeyForSession(childSource())
    expect(livePresetMounts(ctx.fiber).find(mount => mount.key === key)?.variant).toBe('admitted')
  })

  it('validates configured child history during create and rejects a nonexistent prefix', async () => {
    const { ctx } = await harness([admission(), admission(childSource())])
    const parent = await agentOn(ctx)
    await expect(childOf(ctx, parent, childSource(), 'create')).rejects.toThrow(/truncated/)
    expect(ctx.agents.get(SessionId('child'))).toBeUndefined()
  })

  it.each([{ parentSession: SessionId('unrelated') }, { cwd: CWD + '/.' }, { agentPreset: 'unique-host' }])('rejects fresh child identity mismatch %j', async (fields) => {
    const { ctx } = await harness()
    const parent = await agentOn(ctx)
    const input = childSource()
    await expect(childOf(ctx, parent, { ...input, header: { ...input.header, ...fields } }, 'create')).rejects.toThrow(/direct parent, cwd, or logical preset/)
  })

  it('retains ordinary unique-host descendant resume behavior without admissions', async () => {
    const { ctx } = await harness([])
    const parent = await agentOn(ctx, source('legacy', { agentPreset: 'unique-host' }))
    const child = await childOf(ctx, parent, source('child', { parentSession: parent.id, agentPreset: 'unique-host' }), 'resume', true)
    expect(standingMountFor(child.ctx)).toBe(standingMountFor(parent.ctx))
    expect(standingMountFor(child.ctx)?.variant).toBe('ordinary')
  })

  it('rejects a configured admitted child of an ordinary parent before binding', async () => {
    const { ctx } = await harness([admission(childSource())])
    const parent = await agentOn(ctx)
    await expect(childOf(ctx, parent, childSource(), 'resume', true)).rejects.toThrow(/conflicts/)
  })
})
