import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresets from '../src/index.ts'
import { expect, it, onTestFinished } from 'vitest'

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'profile-access-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  for (const [id, policy] of [['review', 'read-only'], ['coding', 'workspace-write'], ['broken', 'missing'], ['inherited', '__proto__']] as const) {
    await mkdir(join(root, id))
    await writeFile(join(root, id, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(root, id, 'access.yml'), `permissionPreset: ${policy}\n`)
  }
  const host = Symbol.for('@deepseek-ai/dsh/host-execution-world')
  const providers = { executionWorld: host as symbol | object }
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['llm', LlmRuntime], ['sessions', SessionStore], ['projections', SessionProjectionRegistry],
    ['prompt', SystemPrompt], ['tools', ToolRuntime], ['agents', AgentRegistry], ['loop', AgentLoop],
    ['presets', AgentPresets], ['approval', ApprovalService], ['permission', PermissionPresets],
    ['providers', { apply(inner: Context) {
      // The OS adapters are outside this test; Loader, profile mounting, session creation, and policy are real.
      for (const key of ['fs', 'subprocess'] as const) inner.effect(() => inner.provide(key, providers as never))
      inner.effect(() => inner.provide('shell', { sandboxMode: 'workspace-write' } as never))
    } }],
  ])
  for (const [name, module] of modules) ctx.loader.builtins[name] = module as never
  await writeFile(join(root, 'cordis.yml'), [
    ...['llm', 'sessions', 'projections', 'prompt', 'tools', 'agents', 'loop', 'providers', 'approval'].map(name => `- name: cordis:${name}`),
    '- name: cordis:presets', '  config:', '    default: review', '    includeShippedRoot: false', '    includeUserRoot: false',
    `    roots: [{ path: ${JSON.stringify(root)}, trust: system }]`,
    '- name: cordis:permission', '  config:', '    presets:',
    '      read-only: { sandbox: read-only, approval: ask }',
    '      workspace-write: { sandbox: workspace-write, approval: ask }',
    '      danger-full-access: { sandbox: danger-full-access, approval: never }', '',
  ].join('\n'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  const create = async (id: string, profile = 'review', seed?: readonly SessionEvent[]) => (await ctx.agents.create({
    sessionId: SessionId(id),
    ...seed === undefined ? {} : { seed },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, profile) },
  })).agent
  return { ctx, root, providers, create }
}

it('loads profile defaults, accepts a blank override, and rejects changes after the first turn', async () => {
  const { ctx, create } = await harness()
  const agent = await create('new')
  expect(ctx.permissionPresets.current(agent.session)).toBe('read-only')
  expect(ctx.sessionProjections.snapshot(agent.session).values.permissions).toMatchObject({
    canChange: true, context: { environment: 'host', defaultPreset: 'read-only' },
  })
  ctx.permissionPresets.set(agent.session, 'danger-full-access')
  await ctx.agentPresets.select(agent, 'coding')
  expect(ctx.permissionPresets.current(agent.session)).toBe('workspace-write')
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect(() => { ctx.permissionPresets.set(agent.session, 'danger-full-access') }).toThrow('access is fixed')
  expect(ctx.sessionProjections.snapshot(agent.session).values.permissions?.canChange).toBe(false)
  await expect(ctx.agentPresets.select(agent, 'review')).rejects.toThrow('already started')
})

it('rejects unsupported profile defaults before publishing or replacing a profile', async () => {
  const { ctx, create } = await harness()
  await expect(create('invalid', 'broken')).rejects.toThrow('unknown preset')
  await expect(create('inherited', 'inherited')).rejects.toThrow('unknown preset')
  expect(ctx.agents.get(SessionId('invalid'))).toBeUndefined()
  const agent = await create('valid')
  await expect(ctx.agentPresets.select(agent, 'broken')).rejects.toThrow('unknown preset')
  expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('review')
  expect(ctx.permissionPresets.current(agent.session)).toBe('read-only')
})

it('preserves saved permissions across profile edits and refuses host-to-external resume', async () => {
  const { ctx, create, root, providers } = await harness()
  const first = await create('first')
  ctx.permissionPresets.set(first.session, 'danger-full-access')
  first.session.append('turn/start', { turn: 1 })
  first.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const seed = first.session.snapshotEvents()
  await writeFile(join(root, 'review', 'access.yml'), 'permissionPreset: workspace-write\n')
  const next = await create('next')
  expect(ctx.permissionPresets.current(next.session)).toBe('workspace-write')
  const restored = await create('restored', 'review', seed)
  expect(ctx.permissionPresets.current(restored.session)).toBe('danger-full-access')
  expect(ctx.sessionProjections.snapshot(restored.session).values.permissions?.context?.defaultPreset).toBe('read-only')
  providers.executionWorld = {}
  await expect(create('wrong-world', 'review', seed)).rejects.toThrow('different execution environment')
  expect(ctx.agents.get(SessionId('wrong-world'))).toBeUndefined()
})
