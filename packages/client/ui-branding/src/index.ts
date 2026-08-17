/** Host registration for durable product branding and pre-plugin browser metadata. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  BRANDING_SETTINGS_NAMESPACE, BrandingSettingsSchema, type BrandingSettings,
} from './branding-settings.ts'
import {
  BRANDING_LOGO_PATH, BRANDING_MANIFEST_PATH, brandingManifest, decodeProductLogo,
  DEFAULT_BRANDING, injectBootBranding,
} from './boot-branding.ts'

export {
  BRANDING_SETTINGS_NAMESPACE, BrandingSettingsSchema, DEFAULT_PRODUCT_NAME,
  PRODUCT_LOGO_FIELD, PRODUCT_LOGO_MAX_BYTES, PRODUCT_LOGO_MIME_TYPES,
  PRODUCT_NAME_FIELD, PRODUCT_NAME_MAX_LENGTH,
  type BrandingSettings, type ProductLogoMimeType,
} from './branding-settings.ts'
export {
  BRANDING_LOGO_PATH, BRANDING_MANIFEST_PATH, DEFAULT_BRANDING, DEFAULT_FAVICON_PATH,
  brandingManifest, decodeProductLogo, injectBootBranding,
} from './boot-branding.ts'

const BRANDING_NAMESPACE = settingsNamespace(BRANDING_SETTINGS_NAMESPACE)

function readBranding(ctx: Context): BrandingSettings {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_BRANDING
  return settings.get(BRANDING_NAMESPACE) as BrandingSettings | undefined ?? DEFAULT_BRANDING
}

function allowRead(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  res.writeHead(405)
  res.end()
  return false
}

/** Register the durable namespace, index transform, manifest, and current-logo route. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(BRANDING_NAMESPACE, BrandingSettingsSchema)
  })

  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectBootBranding(html, readBranding(ctx))),
      'client-ui-branding: index identity',
    )
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'exact',
      path: BRANDING_MANIFEST_PATH,
      handler: (req, res) => {
        if (!allowRead(req, res)) return
        const body = JSON.stringify(brandingManifest(readBranding(ctx)))
        res.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/manifest+json',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    }), 'client-ui-branding: manifest route')
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'exact',
      path: BRANDING_LOGO_PATH,
      handler: (req, res) => {
        if (!allowRead(req, res)) return
        const logo = readBranding(ctx).logo
        if (logo === undefined) {
          res.writeHead(302, { 'cache-control': 'no-store', location: '/favicon.svg' })
          res.end()
          return
        }
        const decoded = decodeProductLogo(logo)
        res.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': decoded.type,
        })
        res.end(req.method === 'HEAD' ? undefined : decoded.body)
      },
    }), 'client-ui-branding: logo route')
  })
}
