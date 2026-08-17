import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  apply, BRANDING_LOGO_PATH, BRANDING_MANIFEST_PATH, BRANDING_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-client-ui-branding'

const PNG = 'data:image/png;base64,YQ=='

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

class ResponseFake {
  status = 0
  headers: Record<string, string> = {}
  body: unknown
  writeHead(status: number, headers: Record<string, string> = {}): void {
    this.status = status
    this.headers = headers
  }
  end(body?: unknown): void { this.body = body }
}

function provideWebServer(ctx: Context) {
  let transform: ((html: string) => string) | undefined
  const routes = new Map<string, WebRoute>()
  ctx.provide('webServer', {
    tapIndex: (next: (html: string) => string) => {
      transform = next
      return () => { transform = undefined }
    },
    register: (route: WebRoute) => {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  } as WebServer)
  return { routes, transform: () => transform }
}

async function request(route: WebRoute, method: string): Promise<ResponseFake> {
  const response = new ResponseFake()
  await route.handler({ method } as never, response as never)
  return response
}

describe('ui-branding Host plugin', () => {
  it('registers durable settings and serves current title, manifest, and logo', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const web = provideWebServer(ctx)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(BRANDING_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ name: 'the harness' })
    expect(web.transform()?.('<head><title>Old</title></head>')).toContain('<title>the harness</title>')

    const manifestRoute = web.routes.get(BRANDING_MANIFEST_PATH)!
    const initialManifest = await request(manifestRoute, 'GET')
    expect(initialManifest.status).toBe(200)
    expect(JSON.parse(initialManifest.body as string)).toMatchObject({ name: 'the harness' })

    const logoRoute = web.routes.get(BRANDING_LOGO_PATH)!
    const defaultLogo = await request(logoRoute, 'GET')
    expect(defaultLogo.status).toBe(302)
    expect(defaultLogo.headers.location).toBe('/favicon.svg')

    await ctx.settings.update(ns, { name: 'Studio', logo: PNG })
    expect(web.transform()?.('<head></head>')).toContain('<title>Studio</title>')
    const manifest = await request(manifestRoute, 'HEAD')
    expect(manifest.status).toBe(200)
    expect(manifest.body).toBeUndefined()
    const logo = await request(logoRoute, 'GET')
    expect(logo.status).toBe(200)
    expect(logo.headers['content-type']).toBe('image/png')
    expect((logo.body as Buffer).toString('utf8')).toBe('a')
    expect((await request(logoRoute, 'HEAD')).body).toBeUndefined()
    expect((await request(logoRoute, 'POST')).status).toBe(405)

    await expect(ctx.settings.update(ns, { name: '' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { logo: 'data:image/svg+xml;base64,YQ==' })).rejects.toThrow()
    await fiber.dispose()
    expect(web.routes.size).toBe(0)
    expect(web.transform()).toBeUndefined()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('uses defaults when only the HTTP service is composed', async () => {
    const ctx = new Context()
    const web = provideWebServer(ctx)
    await ctx.plugin({ apply }).await()
    expect(web.transform()?.('<head></head>')).toContain('<title>the harness</title>')
    const manifest = await request(web.routes.get(BRANDING_MANIFEST_PATH)!, 'GET')
    expect(JSON.parse(manifest.body as string)).toMatchObject({ name: 'the harness' })
  })
})
