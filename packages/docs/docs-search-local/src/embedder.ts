/**
 * Embedding adapter over `@huggingface/transformers` feature extraction.
 *
 * The model is loaded lazily on first use and the module is imported lazily
 * with it, so a composition that only ever searches lexically never loads the
 * runtime. A load failure is reported to the caller as a degradation reason,
 * never thrown into a search.
 *
 * Two invariants decide recall quality and are therefore fixed here rather
 * than left to the call site:
 * - The document and query prefixes are applied by this adapter, so every
 *   stored chunk and every query are formatted the same way.
 * - Truncated vectors are L2-normalized after truncation. EmbeddingGemma's
 *   Matryoshka truncation is only approximately normalized, and a vector arm
 *   ranked by dot product must compare unit vectors.
 * @module @deepseek-ai/dsh-docs-search-local/embedder
 */

import { resolve } from 'node:path'

/** Embedding widths EmbeddingGemma supports for Matryoshka truncation. */
export const DOCS_SEARCH_ALLOWED_DIMENSIONS = [128, 256, 512, 768] as const

/** Full embedding width EmbeddingGemma emits before truncation. */
export const DOCS_SEARCH_MODEL_DIMENSIONS = 768

/** Query prefix EmbeddingGemma was trained with; applied verbatim. */
export const DOCS_SEARCH_QUERY_PREFIX = 'task: search result | query: '

/** Document prefix EmbeddingGemma was trained with; applied verbatim. */
export const DOCS_SEARCH_DOCUMENT_PREFIX = 'text: '

/** Title segment of the document prefix, formatted with the chunk title or `none`. */
export const DOCS_SEARCH_TITLE_PREFIX = 'title: '

/** Resolved embedding configuration. */
export interface DocsEmbedderConfig {
  /** Hugging Face model id serving the ONNX feature-extraction pipeline. */
  modelId: string
  /** ONNX weight precision. `fp16` is refused: EmbeddingGemma's fp16 export degenerates. */
  dtype: 'q8' | 'q4' | 'int8' | 'fp32'
  /** Local model directory; when set, only local weights load and no download is attempted. */
  localModelPath?: string
  /** Vector width stored in the index, reached by Matryoshka truncation. */
  dimensions: number
  /** Directory the runtime caches downloaded weights under. */
  cacheRoot: string
  /** Texts per embedding call. */
  batchSize: number
}

/**
 * The surface the provider depends on. It exists so tests can substitute a
 * deterministic embedder without loading real weights.
 */
export interface DocsEmbedder {
  /**
   * Embed stored document chunks.
   * @param titles - chunk titles, used for the `title: …` prefix segment.
   * @param bodies - chunk bodies, used for the `text: …` prefix segment.
   * @returns one L2-normalized vector per chunk, in input order.
   */
  embedDocs(titles: readonly string[], bodies: readonly string[]): Promise<number[][]>
  /**
   * Embed one caller query.
   * @param text - raw query text without a prefix.
   * @returns one L2-normalized query vector.
   */
  embedQuery(text: string): Promise<number[]>
  /** Release native inference resources after outstanding calls settle. */
  dispose(): Promise<void>
}

/** Outcome of preparing the embedding backend. */
export type EmbedderLoadResult =
  | { readonly ok: true; readonly embedder: DocsEmbedder }
  | { readonly ok: false; readonly reason: string }

/** Feature-extraction output as transformers.js v3 returns it. */
interface FeatureTensor {
  /** Tensor shape: `[batch]`, `[batch, width]`, or `[batch, tokens, width]`. */
  readonly dims: readonly number[]
  /** Flattened embedding values in row-major order. */
  readonly data: ArrayLike<number>
}

/** The minimal pipeline surface this adapter calls. */
type FeaturePipeline = {
  (texts: string[], options: { pooling: 'mean'; normalize: boolean }): Promise<FeatureTensor>
  dispose(): Promise<void>
}

/**
 * Prepare an EmbeddingGemma embedder. The transformers module and the model
 * weights are both loaded here, on first use.
 * @param config - validated embedding configuration.
 * @returns the ready embedder, or the one-line reason it could not be prepared.
 */
export async function createDocsEmbedder(config: DocsEmbedderConfig): Promise<EmbedderLoadResult> {
  try {
    const { pipeline } = await import('@huggingface/transformers')
    const model = config.localModelPath === undefined ? config.modelId : resolve(config.localModelPath)
    const extract = await pipeline('feature-extraction', model, {
      dtype: config.dtype,
      cache_dir: config.cacheRoot,
      local_files_only: config.localModelPath !== undefined,
    }) as unknown as FeaturePipeline
    return { ok: true, embedder: new TransformersDocsEmbedder(extract, config) }
  } catch (error: unknown) {
    return { ok: false, reason: `embedding model "${config.modelId}" is unavailable: ${errorMessage(error)}` }
  }
}

/**
 * Truncate a full-width embedding to the configured Matryoshka width and
 * re-normalize it.
 *
 * The pipeline's own `normalize` option normalizes the full-width output;
 * truncating that vector discards the mass behind the retained dimensions, so
 * the result is only approximately unit length. Every vector this adapter
 * returns is normalized here, after truncation.
 * @param values - full-width embedding values.
 * @param dimensions - retained leading dimensions.
 * @returns the truncated unit vector.
 */
export function truncateAndNormalize(values: ArrayLike<number>, dimensions: number): number[] {
  const truncated: number[] = []
  for (let index = 0; index < dimensions && index < values.length; index += 1) truncated.push(Number(values[index]))
  let sum = 0
  for (const value of truncated) sum += value * value
  const norm = Math.sqrt(sum)
  if (truncated.length !== dimensions || !Number.isFinite(norm) || norm === 0) {
    throw new Error('embedding output must contain a finite nonzero vector of the configured width')
  }
  return truncated.map(value => value / norm)
}

/**
 * Format the document text EmbeddingGemma expects for one chunk.
 * @param title - chunk title, or an empty string for a titleless section.
 * @param body - chunk body.
 * @returns the prefixed document text.
 */
export function documentText(title: string, body: string): string {
  return `${DOCS_SEARCH_TITLE_PREFIX}${title.length === 0 ? 'none' : title} | ${DOCS_SEARCH_DOCUMENT_PREFIX}${body}`
}

/**
 * Format the query text EmbeddingGemma expects.
 * @param query - raw caller query.
 * @returns the prefixed query text.
 */
export function queryText(query: string): string {
  return `${DOCS_SEARCH_QUERY_PREFIX}${query}`
}

/** Embedder backed by one loaded transformers.js feature-extraction pipeline. */
class TransformersDocsEmbedder implements DocsEmbedder {
  constructor(
    private readonly extract: FeaturePipeline,
    private readonly config: DocsEmbedderConfig,
  ) {}

  async dispose(): Promise<void> {
    await this.extract.dispose()
  }

  async embedDocs(titles: readonly string[], bodies: readonly string[]): Promise<number[][]> {
    const vectors: number[][] = []
    for (let offset = 0; offset < bodies.length; offset += this.config.batchSize) {
      const batch = bodies
        .slice(offset, offset + this.config.batchSize)
        .map((body, index) => documentText(titles[offset + index] as string, body))
      const tensor = await this.extract(batch, { pooling: 'mean', normalize: true })
      vectors.push(...rowsOf(tensor, this.config.dimensions, batch.length))
    }
    return vectors
  }

  async embedQuery(text: string): Promise<number[]> {
    const tensor = await this.extract([queryText(text)], { pooling: 'mean', normalize: true })
    const rows = rowsOf(tensor, this.config.dimensions, 1)
    return rows[0] as number[]
  }
}

/** Project a feature tensor into one truncated, normalized vector per batch row. */
function rowsOf(tensor: FeatureTensor, dimensions: number, expectedRows: number): number[][] {
  const width = tensor.dims.at(-1) ?? 0
  if (tensor.dims.length !== 2 || tensor.dims[0] !== expectedRows || width < dimensions || tensor.data.length !== expectedRows * width) {
    throw new Error('embedding output has unexpected tensor dimensions')
  }
  const rows = expectedRows
  const vectors: number[][] = []
  for (let row = 0; row < rows; row += 1) {
    const start = row * width
    const values = Array.from({ length: width }, (_, index) => Number(tensor.data[start + index]))
    vectors.push(truncateAndNormalize(values, dimensions))
  }
  return vectors
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
