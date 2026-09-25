/** Authenticated navigation from a live conversation to a separate guest preview origin. @module */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from './workspaces.ts'
import { VmPreviewServer, type PreviewConfig } from './vm-preview-server.ts'

/** Deployment-owned preview listener and origin bounds. */
export type Config = PreviewConfig
/** Optional plugin identity. */
export const name = 'development-vm-previews'
/** The normal authenticated connection and live conversation workspace owner. */
export const inject = ['connection', 'conversationWorkspaces']
/** Every deployment-varying bound is explicit. */
export const Config: z<Config> = z.object({
  port: z.natural().max(65535).required(), originTemplate: z.string().required(), controlOrigin: z.string().required(),
  grantLifetimeMs: z.natural().required(), maxGrants: z.natural().required(),
  maxConnections: z.natural().required(), idleTimeoutMs: z.natural().required(),
})

/** Register authenticated preview navigation and own the separate listener.
 * @param ctx - authenticated connection and live workspace services.
 * @param config - explicit preview deployment configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const previews = new VmPreviewServer(config)
  await previews.listen()
  ctx.effect(() => () => previews.dispose(), 'development preview listener')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/development-preview', methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const portValue = url.searchParams.get('port') ?? ''
      const port = Number(portValue)
      if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(sessionId) || !/^\d+$/u.test(portValue) || port < 1024 || port > 65535) return new Response('Invalid conversation or port', { status: 400 })
      const id = brandString<SessionId>(sessionId)
      const available = await ctx.conversationWorkspaces.runForSession(
        id, async () => ctx.conversationWorkspaces.capture().connectPreview !== undefined,
      )
      if (!available) return new Response('This conversation has no development VM', { status: 409 })
      const location = previews.issue(() => ctx.conversationWorkspaces.connectPreviewForSession(id, port))
      return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
    },
  }), 'authenticated development preview navigation')
}
