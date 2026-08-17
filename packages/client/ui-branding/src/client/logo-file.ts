/** Browser file conversion for bounded uploaded product logos. */

import {
  PRODUCT_LOGO_MAX_BYTES, PRODUCT_LOGO_MIME_TYPES, type ProductLogoMimeType,
} from '../branding-settings.ts'

/** User-facing logo-file validation failure. */
export class ProductLogoFileError extends Error {
  /**
   * @param code - stable reason used by localized UI copy.
   */
  constructor(readonly code: 'format' | 'size') {
    super(code === 'format' ? 'unsupported product logo format' : 'product logo exceeds 512 KiB')
  }
}

/**
 * Validate and encode one browser-selected logo.
 * @param file - user-selected raster image.
 * @returns a schema-compatible base64 data URL.
 */
export async function encodeProductLogo(file: File): Promise<string> {
  if (!PRODUCT_LOGO_MIME_TYPES.includes(file.type as ProductLogoMimeType)) {
    throw new ProductLogoFileError('format')
  }
  if (file.size > PRODUCT_LOGO_MAX_BYTES) throw new ProductLogoFileError('size')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return `data:${file.type};base64,${btoa(binary)}`
}
