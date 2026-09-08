import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Approval from '@deepseek-ai/dsh-user-approval'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Sessions from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Workspaces from '@deepseek-ai/dsh-workspace'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, test } from 'vitest'
import ForgeProjectWorkspaces from '../src/index.ts'

const modules = new Map<string, unknown>([
  ['storage', Storage], ['storage-json', StorageJson], ['storage-domain', StorageDomain],
  ['sessions', Sessions], ['persistence', Persistence], ['workspaces', Workspaces],
  ['webserver', WebServer], ['forge-projects', ForgeProjectWorkspaces],
  ['agents', AgentRegistry], ['prompt', SystemPrompt], ['tools', Tools], ['approval', Approval],
])

async function boot(root: string): Promise<Context> {
  const file = join(root, 'cordis.yml')
  await writeFile(file, JSON.stringify([
    { name: 'storage' }, { name: 'storage-json', config: { root: join(root, 'storage') } },
    { name: 'storage-domain', config: { backend: 'json' } }, { name: 'sessions' },
    { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: 'workspaces' }, { name: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { name: 'agents' }, { name: 'prompt' }, { name: 'tools' }, { name: 'approval', config: { policy: 'never' } },
    { name: 'forge-projects', config: {
      managedDirectoryPicker: true,
      token: 'test-catalog-token', workspaceRoot: join(root, 'workspaces'),
      publicationStateFile: join(root, 'catalog.json'),
      forgejoBaseUrl: 'http://forgejo:3000', forgejoToken: 'test-forgejo-token',
    } },
  ]))
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  return ctx
}

test('real Loader serves persisted project identities after restart without changing files or registry', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-catalog-loader-')))
  let ctx: Context | undefined
  const headers = { authorization: 'Bearer test-catalog-token', 'content-type': 'application/json' }
  try {
    ctx = await boot(root)
    expect(ctx.directoryPicker.capability()).toEqual({ kind: 'forge-managed' })
    let url = `http://127.0.0.1:${String(ctx.webServer.port)}/forge/v1/projects/sync`
    expect((await fetch(url)).status).toBe(401)
    const replacement = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ projects: [
      { project_id: 'PROJECT:atlas', slug: 'atlas', title: 'Atlas', repository: null },
    ] }) })
    expect(replacement.status).toBe(200)
    const first = await replacement.json() as { projects: Array<{ workspace_id: string }> }
    await writeFile(join(root, 'workspaces/atlas/dirty.txt'), 'keep pending work')
    await mkdir(join(root, 'workspaces/unregistered'))
    await ctx.fiber.dispose()
    ctx = await boot(root)
    url = `http://127.0.0.1:${String(ctx.webServer.port)}/forge/v1/projects/sync`
    const status = await fetch(url, { headers })
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ projects: [
      { project_id: 'PROJECT:atlas', workspace_id: first.projects[0]!.workspace_id, repository: null },
    ] })
    expect(ctx.workspaceRegistry.list()).toHaveLength(1)
    expect(await readFile(join(root, 'workspaces/atlas/dirty.txt'), 'utf8')).toBe('keep pending work')
    await ctx.fiber.dispose()
    ctx = undefined
    await expect(fetch(url, { headers })).rejects.toThrow()
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)


test('real Loader publication uses persisted session bindings and explicit approval, refusing an edited origin', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-publish-loader-')))
  const exec = promisify(execFile)
  const path = join(root, 'workspaces', 'atlas')
  let ctx: Context | undefined
  try {
    await mkdir(path, { recursive: true })
    const git = (...args: string[]): Promise<{ stdout: string }> => exec('git', ['-C', path, ...args])
    await git('init', '--initial-branch=codex/change')
    await git('config', 'user.name', 'Fixture')
    await git('config', 'user.email', 'fixture@example.invalid')
    await git('remote', 'add', 'origin', 'http://forgejo:3000/apps/atlas.git')
    await writeFile(join(path, 'file.txt'), 'committed content')
    await git('add', '.')
    await git('commit', '-m', 'fixture')
    ctx = await boot(root)
    const url = `http://127.0.0.1:${String(ctx.webServer.port)}/forge/v1/projects/sync`
    expect((await fetch(url, { method: 'PUT', headers: {
      authorization: 'Bearer test-catalog-token', 'content-type': 'application/json',
    }, body: JSON.stringify({ projects: [{ project_id: 'PROJECT:atlas', slug: 'atlas', title: 'Atlas', repository: 'apps/atlas' }] }) })).status).toBe(200)
    await ctx.fiber.dispose()
    ctx = await boot(root)
    const session = ctx.sessions.create(SessionId('publication'), { meta: { cwd: path } })
    const workspace = ctx.workspaceRegistry.list()[0]!
    const owner: Agent = {
      id: session.id, options: {}, session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle', ctx, followup() {}, steer() {}, inject() {}, send() {}, cancel() {},
      runMaintenance: operation => operation(new AbortController().signal), whenIdle: () => Promise.resolve(),
    }
    ctx.agents.register(owner)
    session.append('turn/start', { turn: 1 })
    let callNumber = 0
    const call = (args: Record<string, unknown> = {}) => ctx!.tools.execute({
      agent: owner, signal: new AbortController().signal, callId: CallId(`publish-${String(++callNumber)}`), name: 'forge_push_branch', arguments: args,
    })
    expect(ctx.tools.schemas().find(tool => tool.name === 'forge_push_branch')?.parameters).toMatchInlineSnapshot(`
      {
        "properties": {},
        "type": "object",
      }
    `)
    expect(JSON.stringify(await call())).toContain('persisted Forge repository binding')
    expect(session.events.filter(event => event.type === 'approval/asked')).toHaveLength(0)
    await workspace.attachSession(session.id)
    expect(JSON.stringify(await call({ force: true }))).toContain('accepts no branch')
    const rejected = await call()
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected)).toContain('not approved')
    expect(session.events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    expect(session.events.find(event => event.type === 'approval/decided')?.data).toMatchObject({ outcome: 'rejected' })
    await git('remote', 'set-url', 'origin', 'http://forgejo:3000/apps/other.git')
    expect(JSON.stringify(await call())).toContain('registered Forge repository')
    expect(session.events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    await git('remote', 'set-url', 'origin', 'http://forgejo:3000/apps/atlas.git')
    ctx.approval.setPolicy(owner, 'ask')
    ctx.on('approval/request', async (req) => {
      expect(req.toolName).toBe('forge_push_branch')
      expect(req.reason).toContain('apps/atlas branch codex/change')
      await writeFile(join(path, 'file.txt'), 'changed while waiting for approval')
      await git('add', '.')
      await git('commit', '-m', 'changed')
      return 'allowed-once'
    })
    expect(JSON.stringify(await call())).toContain('changed after publication approval')
    expect(session.events.filter(event => event.type === 'approval/decided').at(-1)?.data)
      .toMatchObject({ outcome: 'allowed-once' })
    const registry = ctx.tools
    await ctx.fiber.dispose()
    ctx = undefined
    expect(registry.schemas().some(tool => tool.name === 'forge_push_branch')).toBe(false)
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
