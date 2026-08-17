/** Durable product-branding settings shared by the Host and browser plugin. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the branding plugin. */
export const BRANDING_SETTINGS_NAMESPACE = 'ui-branding'

/** Field carrying the product name shown by browser surfaces. */
export const PRODUCT_NAME_FIELD = 'name'

/** Field carrying an uploaded raster logo as a base64 data URL. */
export const PRODUCT_LOGO_FIELD = 'logo'

/** Default browser product name. */
export const DEFAULT_PRODUCT_NAME = 'the harness'

/** Longest product name accepted by settings and the browser editor. */
export const PRODUCT_NAME_MAX_LENGTH = 48

/** Largest uploaded logo payload before base64 encoding. */
export const PRODUCT_LOGO_MAX_BYTES = 512 * 1024

/** Raster formats accepted for a user-provided logo. */
export const PRODUCT_LOGO_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
] as const

/** Uploaded logo media type. */
export type ProductLogoMimeType = typeof PRODUCT_LOGO_MIME_TYPES[number]

const MIME_PATTERN = PRODUCT_LOGO_MIME_TYPES.map(type => type.replace('/', '\\/')).join('|')
const PRODUCT_LOGO_PATTERN = new RegExp(`^data:(?:${MIME_PATTERN});base64,[A-Za-z0-9+/]+={0,2}$`)
const PRODUCT_LOGO_MAX_DATA_URL_LENGTH = 64 + Math.ceil(PRODUCT_LOGO_MAX_BYTES / 3) * 4

/** Durable branding section shared by the Host schema and browser scope. */
export interface BrandingSettings {
  /** Product name shown in browser chrome and the application shell. */
  name: string
  /** Uploaded raster logo; absence uses the built-in fish mark. */
  logo?: string
}

/** Durable schema; invalid names and non-raster or oversized logo data fail at the settings boundary. */
export const BrandingSettingsSchema: z<BrandingSettings> = z.object({
  [PRODUCT_NAME_FIELD]: z.string()
    .min(1)
    .max(PRODUCT_NAME_MAX_LENGTH)
    .pattern(/\S/)
    .default(DEFAULT_PRODUCT_NAME),
  [PRODUCT_LOGO_FIELD]: z.string()
    .max(PRODUCT_LOGO_MAX_DATA_URL_LENGTH)
    .pattern(PRODUCT_LOGO_PATTERN)
    .required(false),
})

/**
 * Normalize and validate a name before an optimistic browser write.
 * @param value - editor value supplied by the user.
 * @returns trimmed persistable name.
 */
export function normalizeProductName(value: string): string {
  const name = value.trim()
  if (name.length === 0 || name.length > PRODUCT_NAME_MAX_LENGTH) {
    throw new TypeError(`product name must contain 1-${PRODUCT_NAME_MAX_LENGTH} characters`)
  }
  return name
}

/**
 * Test whether a string is an accepted uploaded-logo data URL.
 * @param value - value crossing the browser service boundary.
 * @returns whether the value is schema-compatible.
 */
export function isProductLogoDataUrl(value: string): boolean {
  return value.length <= PRODUCT_LOGO_MAX_DATA_URL_LENGTH && PRODUCT_LOGO_PATTERN.test(value)
}

/**
 * Read the media type from one validated uploaded logo.
 * @param value - schema-compatible logo data URL.
 * @returns its raster media type.
 */
export function productLogoMimeType(value: string): ProductLogoMimeType {
  const mime = value.slice('data:'.length, value.indexOf(';'))
  if (!PRODUCT_LOGO_MIME_TYPES.some(candidate => candidate === mime)) {
    throw new TypeError('product logo has an unsupported media type')
  }
  return mime as ProductLogoMimeType
}
