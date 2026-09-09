/** PDF worker code and document-scoped binary resource access. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { PDF_ASSET_ENDPOINT, type PdfAssetKind, type ReadPdfAsset } from '../../pdf-assets.ts'

export type { PdfAssetKind, PdfAssetMap, ReadPdfAsset } from '../../pdf-assets.ts'

/** Public methods required by PDF.js BinaryDataFactory. */
export interface PdfBinaryDataFactory {
  /** @param request - PDF.js resource kind and exact filename. @returns independently transferable bytes. */
  fetch(request: { readonly kind: PdfAssetKind; readonly filename: string }): Promise<Uint8Array>
}

/**
 * Bind resource reads to the shell's authenticated carrier, including local Worker and desktop transports.
 * @param rpc - active Connection's generic unary carrier.
 * @returns exact-name resource reader with caller-owned cancellation.
 */
export function createReadPdfAsset(rpc: ClientConnectionRpc): ReadPdfAsset {
  return async (kind, filename, signal) => {
    const result = await rpc.call('/api', PDF_ASSET_ENDPOINT, { kind, filename }, signal)
    if (!result.ok) throw new Error(result.error.message)
    if (typeof result.value !== 'string') throw new TypeError('PDF resource response must contain base64 text')
    return Uint8Array.from(atob(result.value), character => character.charCodeAt(0))
  }
}

/**
 * Give each PDF document an abortable resource reader; no resource is fetched during shell boot.
 * @param read - exact-name resource provider.
 * @param signal - document lifetime.
 * @returns the constructor passed to PDF.js getDocument.
 */
export function createPdfBinaryDataFactory(read: ReadPdfAsset, signal: AbortSignal): new () => PdfBinaryDataFactory {
  return class implements PdfBinaryDataFactory {
    fetch({ kind, filename }: { readonly kind: PdfAssetKind; readonly filename: string }): Promise<Uint8Array> {
      return read(kind, filename, signal)
    }
  }
}
