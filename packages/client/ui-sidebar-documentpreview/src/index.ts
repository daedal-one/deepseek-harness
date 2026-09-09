/** Host-owned PDF resources, delivered only when an open document requests them. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { PDF_ASSET_ENDPOINT, type PdfAssetMap } from './pdf-assets.ts'

/** The authenticated transport owns request and route lifetimes. */
export const inject = ['connection']

declare global {
  /** Binary resources supplied to the Host artifact by the package build. */
  const __DSH_PDFJS_ASSETS__: PdfAssetMap
}

/**
 * Register exact-name PDF resources from this build without filesystem access.
 * @param ctx - Host context carrying the authenticated Connection registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.connection.rpc.handleRoute(PDF_ASSET_ENDPOINT, (_endpoint, payload) => {
    if (typeof payload === 'object' && payload !== null && 'kind' in payload && 'filename' in payload
      && typeof payload.kind === 'string' && typeof payload.filename === 'string') {
      for (const [kind, files] of Object.entries(__DSH_PDFJS_ASSETS__)) {
        if (payload.kind === kind && Object.hasOwn(files, payload.filename)) {
          return Promise.resolve({ ok: true as const, value: files[payload.filename] })
        }
      }
    }
    return Promise.resolve({ ok: false as const, error: {
      code: 'pdf/asset-not-found', message: 'PDF resource is not bundled', details: {},
    } })
  }), 'document-preview: PDF resources')
}
