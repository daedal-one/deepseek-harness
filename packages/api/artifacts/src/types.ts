/** Trusted artifact control admission policy. @module */
export interface ArtifactPolicy {
  readonly previewAvailable: boolean
  /** Maximum retained viewer bytes, including decoded text and preview pixels. */
  readonly maxRetainedBytes: number
  readonly maxEditBytes: number
  readonly maxSelectionBytes: number
}
