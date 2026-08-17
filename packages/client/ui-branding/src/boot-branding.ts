/** Host-rendered product identity for the browser's pre-plugin interval and install metadata. */

import {
  DEFAULT_PRODUCT_NAME, productLogoMimeType, type BrandingSettings,
} from './branding-settings.ts'

/** Exact route serving the current uploaded logo to favicon and install-metadata consumers. */
export const BRANDING_LOGO_PATH = '/branding/logo'

/** Exact install-metadata route shadowing the static development fallback. */
export const BRANDING_MANIFEST_PATH = '/manifest.webmanifest'

/** Built-in fish favicon used when no logo override exists. */
export const DEFAULT_FAVICON_PATH = '/favicon.svg'

/** Default settings value for compositions without a settings provider. */
export const DEFAULT_BRANDING: BrandingSettings = Object.freeze({ name: DEFAULT_PRODUCT_NAME })

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Project the current product name and favicon route into one application index.
 * @param html - raw application index HTML.
 * @param branding - schema-validated current branding.
 * @returns HTML with current product identity.
 */
export function injectBootBranding(
  html: string,
  branding: BrandingSettings = DEFAULT_BRANDING,
): string {
  const title = `<title>${escapeHtmlText(branding.name)}</title>`
  const titlePattern = /<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i
  let output = titlePattern.test(html)
    ? html.replace(titlePattern, title)
    : html.replace(/<\/head>/i, `${title}\n  </head>`)

  const icon = `<link rel="icon" href="${BRANDING_LOGO_PATH}" />`
  const iconPattern = /<link\b(?=[^>]*\brel=["']icon["'])[^>]*>/i
  output = iconPattern.test(output)
    ? output.replace(iconPattern, icon)
    : output.replace(/<\/head>/i, `${icon}\n  </head>`)
  return output
}

/** Browser-install manifest derived from the current branding settings. */
export interface BrandingManifest {
  id: '/'
  name: string
  short_name: string
  start_url: '/'
  scope: '/'
  display: 'fullscreen'
  icons: [{ src: string; sizes: 'any'; type: string; purpose: 'any' }]
}

/**
 * Build install metadata for the current product identity.
 * @param branding - schema-validated current branding.
 * @returns serializable Web App Manifest.
 */
export function brandingManifest(
  branding: BrandingSettings = DEFAULT_BRANDING,
): BrandingManifest {
  return {
    id: '/',
    name: branding.name,
    short_name: branding.name,
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: branding.logo === undefined ? DEFAULT_FAVICON_PATH : BRANDING_LOGO_PATH,
      sizes: 'any',
      type: branding.logo === undefined ? 'image/svg+xml' : productLogoMimeType(branding.logo),
      purpose: 'any',
    }],
  }
}

/**
 * Decode one schema-validated uploaded logo for an HTTP response.
 * @param logo - accepted raster data URL.
 * @returns media type and binary body.
 */
export function decodeProductLogo(logo: string): { type: string; body: Buffer } {
  const comma = logo.indexOf(',')
  return {
    type: productLogoMimeType(logo),
    body: Buffer.from(logo.slice(comma + 1), 'base64'),
  }
}
