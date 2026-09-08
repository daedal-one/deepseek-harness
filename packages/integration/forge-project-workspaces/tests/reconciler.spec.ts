import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { WorkspaceId, type Workspace, type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it } from 'vitest'
import ForgeProjectWorkspaces, { internals } from '../src/index.ts'

const exec = promisify(execFile)
const roots: string[] = []
const originalClone = internals.cloneRepository

afterEach(async () => {
  internals.cloneRepository = originalClone
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-forge-projects-'))
  roots.push(root)
  return root
}

function registry(): WorkspaceRegistry {
  const items: Workspace[] = []
  let next = 0
  return {
    list: () => [...items],
    create: async (path: string, title?: string) => {
      const canonical = await realpath(path)
      const found = items.find(item => item.path === canonical)
      if (found !== undefined) return found
      let display = title ?? canonical.split('/').at(-1) ?? canonical
      const workspace = {
        id: WorkspaceId(`workspace-${String(++next)}`),
        path: canonical,
        get title() { return display },
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
        sessionIds: [],
        setTitle: async (value: string) => { display = value },
      } as unknown as Workspace
      items.unshift(workspace)
      return workspace
    },
    delete: async (id: WorkspaceId) => {
      const at = items.findIndex(item => item.id === id)
      if (at === -1) return false
      items.splice(at, 1)
      return true
    },
    insertBefore: async (id: WorkspaceId, before?: WorkspaceId) => {
      const at = items.findIndex(item => item.id === id)
      if (at === -1) throw new Error('missing workspace')
      const [item] = items.splice(at, 1)
      const target = before === undefined ? items.length : items.findIndex(candidate => candidate.id === before)
      items.splice(target, 0, item!)
      return items.map(candidate => candidate.id)
    },
  } as unknown as WorkspaceRegistry
}

describe('Forge project workspace composition', () => {
  it('authenticates replacement, materializes one workspace per project, and unregisters stale rows', async () => {
    const root = await tempRoot()
    const workspaceRoot = join(root, 'workspaces')
    const ctx = new Context()
    const workspaces = registry()
    ctx.provide('workspaceRegistry', workspaces)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    internals.cloneRepository = async (path) => {
      await mkdir(path, { recursive: true })
      await exec('git', ['init', path])
      await exec('git', ['-C', path, 'remote', 'add', 'origin', 'http://forgejo:3000/apps/atlas.git'])
      return 'created'
    }
    await ctx.plugin(ForgeProjectWorkspaces, {
      token: 'forge-project-token',
      routePath: '/forge/v1/projects/sync',
      workspaceRoot,
      forgejoBaseUrl: 'http://forgejo:3000',
      forgejoToken: 'forgejo-project-token',
      gitPushTimeoutMs: 60_000, gitReadTimeoutMs: 5000,
      maxRequestBytes: 1024 * 1024,
    })
    const url = `http://127.0.0.1:${String(ctx.webServer.port)}/forge/v1/projects/sync`

    const unauthorized = await fetch(url, { method: 'PUT', body: JSON.stringify({ projects: [] }) })
    expect(unauthorized.status).toBe(401)

    const headers = { authorization: 'Bearer forge-project-token', 'content-type': 'application/json' }
    const first = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        projects: [
          { project_id: 'PROJECT:atlas', slug: 'atlas', title: 'Atlas', repository: 'apps/atlas' },
          { project_id: 'PROJECT:beacon', slug: 'beacon', title: 'Beacon', repository: null },
        ],
      }),
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      protocol: 'dsh-forge-project-workspaces/v1',
      projects: [
        { project_id: 'PROJECT:atlas', slug: 'atlas', repository: 'apps/atlas', materialized: 'created' },
        { project_id: 'PROJECT:beacon', slug: 'beacon', repository: null, materialized: 'created' },
      ],
    })
    expect(workspaces.list().map(item => item.title)).toEqual(['Atlas', 'Beacon'])
    expect((await fetch(url)).status).toBe(401)
    await writeFile(join(workspaceRoot, 'atlas', 'dirty.txt'), 'keep my edits')
    const before = workspaces.list().map(item => ({ id: item.id, title: item.title }))
    const status = await fetch(url, { headers })
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ projects: [
      { project_id: 'PROJECT:atlas', repository: 'apps/atlas', materialized: 'existing' },
      { project_id: 'PROJECT:beacon', repository: null },
    ] })
    expect(workspaces.list().map(item => ({ id: item.id, title: item.title }))).toEqual(before)
    expect(await readFile(join(workspaceRoot, 'atlas', 'dirty.txt'), 'utf8')).toBe('keep my edits')
    await expect(originalClone(await realpath(join(workspaceRoot, 'atlas')), 'apps/other', {
      token: 'forge-project-token', routePath: '/forge/v1/projects/sync', workspaceRoot,
      forgejoBaseUrl: 'http://forgejo:3000', forgejoToken: 'forgejo-project-token', gitPushTimeoutMs: 60_000, gitReadTimeoutMs: 5000, maxRequestBytes: 1024,
    })).rejects.toThrow('different Forgejo repository')

    await exec('git', ['-C', join(workspaceRoot, 'atlas'), 'remote', 'set-url', 'origin', 'https://other.example/apps/atlas.git'])
    expect((await fetch(url, { headers })).status).toBe(422)
    expect(workspaces.list().map(item => ({ id: item.id, title: item.title }))).toEqual(before)
    await exec('git', ['-C', join(workspaceRoot, 'atlas'), 'remote', 'set-url', 'origin', 'http://forgejo:3000/apps/atlas.git'])

    const second = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        projects: [{ project_id: 'PROJECT:beacon', slug: 'beacon', title: 'Beacon App', repository: null }],
      }),
    })
    expect(second.status).toBe(200)
    expect(workspaces.list().map(item => item.title)).toEqual(['Beacon App'])
    await expect(stat(join(workspaceRoot, 'atlas')).then(value => value.isDirectory())).resolves.toBe(true)
    await ctx.fiber.dispose()
  })

  it('rejects mismatched Forge identity without changing the registry', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    const workspaces = registry()
    ctx.provide('workspaceRegistry', workspaces)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(ForgeProjectWorkspaces, {
      token: 'forge-project-token',
      routePath: '/forge/v1/projects/sync',
      workspaceRoot: join(root, 'workspaces'),
      forgejoBaseUrl: 'http://forgejo:3000',
      forgejoToken: 'forgejo-project-token',
      gitPushTimeoutMs: 60_000, gitReadTimeoutMs: 5000,
      maxRequestBytes: 1024,
    })
    const response = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/forge/v1/projects/sync`, {
      method: 'PUT',
      headers: { authorization: 'Bearer forge-project-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        projects: [{ project_id: 'PROJECT:other', slug: 'atlas', title: 'Atlas', repository: null }],
      }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'project_id must equal PROJECT:atlas' })
    expect(workspaces.list()).toEqual([])
    await ctx.fiber.dispose()
  })
})
