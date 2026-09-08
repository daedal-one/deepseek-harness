import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
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
])

async function boot(root: string): Promise<Context> {
  const file = join(root, 'cordis.yml')
  await writeFile(file, JSON.stringify([
    { name: 'storage' }, { name: 'storage-json', config: { root: join(root, 'storage') } },
    { name: 'storage-domain', config: { backend: 'json' } }, { name: 'sessions' },
    { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: 'workspaces' }, { name: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { name: 'forge-projects', config: {
      token: 'test-catalog-token', workspaceRoot: join(root, 'workspaces'),
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
  const root = await mkdtemp(join(tmpdir(), 'forge-catalog-loader-'))
  let ctx: Context | undefined
  const headers = { authorization: 'Bearer test-catalog-token', 'content-type': 'application/json' }
  try {
    ctx = await boot(root)
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
