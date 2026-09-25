import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { provideBrowserCredentials } from '../../../client/connection/tests/browser-credentials.ts'
import type Workspaces from '../src/workspaces.ts'
import * as Previews from '../src/vm-previews.ts'
import { expect, it } from 'vitest'

it('authenticates preview navigation through the real Loader and HTTP connection, and withdraws its route on disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preview-loader-'))
  const ctx = new Context()
  const guestCookies: string[] = []
  const guest = createServer((req, res) => { guestCookies.push(req.headers.cookie ?? ''); res.end('guest app') })
  const selected: string[] = []
  const ports: number[] = []
  try {
    await new Promise<void>((resolve, reject) => { guest.once('error', reject); guest.listen(0, '127.0.0.1', resolve) })
    const address = guest.address()
    if (address === null || typeof address === 'string') throw new Error('missing test guest address')
    const fixtures = {
      name: 'preview-external-services',
      apply(scope: Context) {
        provideBrowserCredentials(scope)
        scope.provide('conversationWorkspaces', {
          runForSession<T>(id: string, operation: () => T) { selected.push(id); return operation() },
          capture: () => ({ connectPreview: () => Promise.reject(new Error('fixture connector must retain a session lease')) }),
          connectPreviewForSession: (_id: string, port: number) => { ports.push(port); return Promise.resolve(connect(address.port, '127.0.0.1')) },
        } as unknown as Workspaces)
      },
    }
    const index = {
      name: 'test-index', inject: ['webServer', 'connection'],
      apply(scope: Context) {
        scope.effect(() => scope.webServer.register({ kind: 'exact', path: '/', handler: (req, res) => {
          if (scope.connection.authorizeIndex(req, res)) res.end('Harness')
        } }), 'test authenticated index')
      },
    }
    const modules = new Map<string, unknown>([['fixtures', fixtures], ['http', WebServer], ['connection', Connection], ['index', index], ['previews', Previews]])
    const config = [
      { name: 'fixtures' }, { name: 'http', config: { host: '127.0.0.1', port: 0 } },
      { name: 'connection' }, { name: 'index' },
      { name: 'previews', config: { port: 0, originTemplate: 'http://{id}.localhost:0', controlOrigin: 'http://127.0.0.1',
        grantLifetimeMs: 60000, maxGrants: 4, maxConnections: 8, idleTimeoutMs: 10000 } },
    ]
    const path = join(root, 'cordis.yml'); await writeFile(path, JSON.stringify(config))
    ctx.baseUrl = pathToFileURL(root).href + '/'; await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      const module = modules.get(specifier); if (module === undefined) throw new Error('unexpected preview fixture module'); return module
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    const composition = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
    await ctx.loader.await()
    const control = `http://127.0.0.1:${ctx.webServer.port}`
    const navigate = `${control}/api/development-preview?sessionId=session-one&port=8080`
    expect((await fetch(navigate)).status).toBe(401)
    expect(selected).toEqual([])
    const login = await fetch(ctx.connection.authenticatedUrl(control), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(login.status).toBe(303)
    const navigation = await fetch(navigate, { headers: { Cookie: cookie }, redirect: 'manual' })
    expect(navigation.status).toBe(303); expect(selected).toEqual(['session-one'])
    const url = new URL(navigation.headers.get('location') ?? '')
    const send = (path: string, method: string, headers: Record<string, string>, body = '') => new Promise<{
      status: number
      cookie: string
      body: string
    }>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: url.port, path, method, headers: { Host: url.host, ...headers } }, (res) => {
        let content = ''; res.on('data', (value) => { content += String(value) })
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '', body: content }) })
      }); req.on('error', reject); req.end(body)
    })
    expect((await send('/private', 'GET', { Cookie: cookie })).status).toBe(401)
    const authorized = await send('/.dsh/authorize', 'POST', { Origin: url.origin }, url.hash.slice(1))
    expect(authorized.status).toBe(204)
    const app = await send('/', 'GET', { Cookie: `${authorized.cookie}; app=state` })
    expect(app).toMatchObject({ status: 200, body: 'guest app' })
    expect(ports).toEqual([8080]); expect(guestCookies).toEqual(['app=state'])
    const connection = ctx.connection
    await ctx.loader.remove(composition)
    expect((await connection.createSharedFetchHandler('/api').fetch(new Request(navigate))).status).toBe(404)
  } finally {
    await ctx.fiber.dispose()
    guest.closeAllConnections()
    if (guest.listening) await new Promise<void>((resolve, reject) => guest.close((error) => { if (error) reject(error); else resolve() }))
    await rm(root, { recursive: true, force: true })
  }
})
