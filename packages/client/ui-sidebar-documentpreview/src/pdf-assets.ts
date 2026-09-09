/** Version-pinned PDF binary resource protocol shared by both package faces. */

/** Exact resource endpoint within the authenticated shared Connection carrier. */
export const PDF_ASSET_ENDPOINT = 'pdf-assets'

/** Version-pinned resource families used by the PDF renderer. */
export type PdfAssetKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl' | 'workerSource'

/** Exact bundled filenames mapped to base64 content. */
export type PdfAssetMap = Readonly<Record<PdfAssetKind, Readonly<Record<string, string>>>>

/**
 * Read an independently transferable PDF resource through the active carrier.
 * @param kind - PDF.js resource family.
 * @param filename - exact filename from the bundled version.
 * @param signal - document lifetime.
 * @returns independently owned resource bytes.
 */
export type ReadPdfAsset = (kind: PdfAssetKind, filename: string, signal: AbortSignal) => Promise<Uint8Array>
