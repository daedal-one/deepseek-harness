/**
 * Local Service Provider for `ctx.docsSearch`: a two-arm index over this
 * repository's own documentation corpus, stored in one SQLite database.
 *
 * The lexical arm is FTS5 BM25; the semantic arm is EmbeddingGemma through
 * `@huggingface/transformers`, truncated to a configured Matryoshka width and
 * L2-normalized after truncation. Results from both arms are fused with
 * Reciprocal Rank Fusion. Every optional asset — the store module, the
 * `sqlite-vec` extension, the embedding model — degrades the semantic arm
 * alone and records one line of reason in {@link DocsSearchStatus.lastError};
 * a search always answers with whatever arms are available.
 * @module @deepseek-ai/dsh-docs-search-local
 */

import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DocsSearcher } from '@deepseek-ai/dsh-docs-search'
import type {
  DocsReindexHandle,
  DocsSearchRequest,
  DocsSearchResult,
  DocsSearchStatus,
  DocsSourceKind,
} from '@deepseek-ai/dsh-docs-search'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import {
  defaultDocsCorpusRules,
  scanDocsCorpus,
  type DocsChunk,
  type DocsCorpusRule,
} from './chunker.ts'
import {
  DOCS_SEARCH_ALLOWED_DIMENSIONS,
  createDocsEmbedder,
  type DocsEmbedder,
  type DocsEmbedderConfig,
} from './embedder.ts'
import {
  DOCS_SEARCH_DEFAULT_LIMIT,
  DOCS_SEARCH_MAX_LIMIT,
  DOCS_SEARCH_SNIPPET_CHARS,
  DocsSearchError,
  filterKinds,
  fuseRanks,
  normalizeLimit,
  normalizeQuery,
  sanitizeFtsQuery,
  toResults,
} from './query.ts'
import { DocsIndexStore } from './store.ts'
import type { ChunkHit } from './store.ts'

export {
  DOCS_SEARCH_ALLOWED_DIMENSIONS,
  DOCS_SEARCH_DOCUMENT_PREFIX,
  DOCS_SEARCH_MODEL_DIMENSIONS,
  DOCS_SEARCH_QUERY_PREFIX,
  DOCS_SEARCH_TITLE_PREFIX,
  documentText,
  queryText,
  truncateAndNormalize,
} from './embedder.ts'
export type { DocsEmbedder, DocsEmbedderConfig } from './embedder.ts'
export { DOCS_SEARCH_RRF_K, DocsSearchError, sanitizeFtsQuery } from './query.ts'
export { DOCS_SEARCH_APPLICATION_ID, DOCS_SEARCH_SCHEMA_VERSION } from './store.ts'
export { defaultDocsCorpusRules, headingSlug, scanDocsCorpus } from './chunker.ts'
export type { DocsChunk, DocsCorpusRule } from './chunker.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    docsIndex: 'docsIndex'
  }
}

/** Default embedding model id. */
export const DOCS_SEARCH_DEFAULT_MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'
/** Default ONNX weight precision. */
export const DOCS_SEARCH_DEFAULT_DTYPE = 'q8'
/** Default vector width. */
export const DOCS_SEARCH_DEFAULT_DIMENSIONS = 256
/** Default texts per embedding call. */
export const DOCS_SEARCH_DEFAULT_BATCH_SIZE = 16

/** Provider configuration; every field is defaulted by {@link LocalDocsSearchService.Config}. */
export interface Config {
  /** Repository root the corpus rules are resolved against. Defaults to the process working directory. */
  root?: string
  /** Corpus rules to index; defaults to {@link defaultDocsCorpusRules}. */
  corpus?: DocsCorpusRule[]
  /** Index database path. Defaults to `<dsh home>/docs-index/docs-search.sqlite`. */
  indexPath?: string
  /** Embedding model directory cache. Defaults to `<dsh home>/models`. */
  cacheRoot?: string
  /** Hugging Face model id serving the feature-extraction pipeline. */
  modelId?: string
  /** ONNX weight precision; `fp16` is refused. */
  dtype?: 'q8' | 'q4' | 'int8' | 'fp32'
  /** Local model directory; when set, no weights are downloaded and only local files load. */
  localModelPath?: string
  /** Stored vector width, reached by Matryoshka truncation. */
  dimensions?: number
  /** Texts per embedding call. */
  batchSize?: number
  /** Maximum characters retained from one section body. */
  maxBodyChars?: number
  /** Fence body length above which a fenced code block is dropped from embedded text. */
  maxCodeLines?: number
  /** Result limit applied when a request omits one. */
  defaultLimit?: number
  /** Largest accepted result limit. */
  maxLimit?: number
  /** Snippet budget in Unicode code points. */
  snippetChars?: number
  /** Open the store and prepare the embedder at activation instead of first use. Defaults to `false`. */
  openAtStart?: boolean
}

/** Configuration resolved and validated at the loader boundary. */
export interface ResolvedConfig extends Required<Omit<Config, 'localModelPath' | 'root'>> {
  root: string
  localModelPath?: string
}

/** Outcome of one index build. */
interface BuildOutcome {
  /** Number of chunks embedded during this build. */
  changed: number
  /** Number of chunks deleted because they left the corpus. */
  removed: number
}

/** The one build in flight, or the last one to finish. */
interface BuildState {
  /** Whether the build is still running. */
  running: boolean
  /** Chunks embedded so far. */
  done: number
  /** Chunks this build must embed. */
  total: number
}

/** Local SQLite-backed hybrid documentation search provider. */
export class LocalDocsSearchService extends DocsSearcher {
  static Config: z<Config> = z.object({
    root: z.string(),
    corpus: z.array(z.object({
      kind: z.union(['readme', 'catalog', 'subsystem', 'note', 'spec', 'guide'] as const).required(),
      root: z.string().required(),
      suffix: z.string().required(),
      recursive: z.boolean().required(),
      packageReadme: z.boolean().required(),
    })),
    indexPath: z.string(),
    cacheRoot: z.string(),
    modelId: z.string(),
    dtype: z.union(['q8', 'q4', 'int8', 'fp32'] as const).default(DOCS_SEARCH_DEFAULT_DTYPE),
    localModelPath: z.string(),
    dimensions: z.union(DOCS_SEARCH_ALLOWED_DIMENSIONS as unknown as number[]).default(DOCS_SEARCH_DEFAULT_DIMENSIONS),
    batchSize: z.number().step(1).min(1).default(DOCS_SEARCH_DEFAULT_BATCH_SIZE),
    maxBodyChars: z.number().step(1).min(1).default(8_000),
    maxCodeLines: z.number().step(1).min(0).default(40),
    defaultLimit: z.number().step(1).min(1).max(DOCS_SEARCH_MAX_LIMIT).default(DOCS_SEARCH_DEFAULT_LIMIT),
    maxLimit: z.number().step(1).min(1).max(DOCS_SEARCH_MAX_LIMIT).default(DOCS_SEARCH_MAX_LIMIT),
    snippetChars: z.number().step(1).min(1).default(DOCS_SEARCH_SNIPPET_CHARS),
    openAtStart: z.boolean().default(false),
  })

  /** Validated and defaulted provider configuration. */
  readonly config: ResolvedConfig

  private readonly rules: DocsCorpusRule[]
  private store: DocsIndexStore | undefined
  private opening: Promise<DocsIndexStore> | undefined
  private embedder: DocsEmbedder | undefined
  private preparing: Promise<DocsEmbedder | undefined> | undefined
  private degradation: string | undefined
  private buildFailure: string | undefined
  private lastError: string | undefined
  private build: BuildState | undefined
  private readonly optionalJobs: Fiber
  private jobRuntime: Context | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = resolveConfig(config)
    this.rules = this.config.corpus.length === 0 ? defaultDocsCorpusRules() : this.config.corpus
    this.optionalJobs = ctx.inject(['jobs'], (jobsCtx) => {
      this.jobRuntime = jobsCtx
      jobsCtx.effect(() => () => {
        this.jobRuntime = undefined
      }, 'docsSearchLocal.jobsBinding')
    })
    ctx.effect(() => () => this.optionalJobs.dispose(), 'docsSearchLocal.optionalJobs')
    ctx.effect(() => () => {
      this.store?.close()
      this.store = undefined
    }, 'docsSearchLocal.close')
    if (this.config.openAtStart) {
      // A failure here is a degradation, not a load failure: the provider must
      // stay mounted so status() can report why the index is unavailable.
      void this.storeHandle().catch(() => undefined)
    }
  }

  override async search(request: DocsSearchRequest): Promise<DocsSearchResult[]> {
    const query = normalizeQuery(request.query)
    const limit = normalizeLimit(request.limit, this.config.defaultLimit, this.config.maxLimit)
    const kinds = filterKinds(request.kind)
    const store = await this.storeHandle()
    const expression = sanitizeFtsQuery(query)
    // Fetch a wider candidate set per arm than the result limit so fusion has
    // cross-arm evidence to work with.
    const armLimit = Math.min(limit * 4, DOCS_SEARCH_MAX_LIMIT * 4)
    const lexical = store.searchLexical(expression, armLimit, kinds)
    const semantic = await this.semanticHits(store, query, armLimit, kinds)
    const fused = fuseRanks(lexical, semantic, limit)
    return toResults(store.metadata(fused.map(candidate => candidate.id)), fused, this.config.snippetChars)
  }

  override status(): DocsSearchStatus {
    const store = this.store
    const lastError: string | undefined = this.lastError
    return {
      chunks: store?.chunkCount() ?? 0,
      indexed: store?.indexedFileCount() ?? 0,
      modelReady: this.embedder !== undefined,
      building: this.build?.running ?? false,
      ...lastError === undefined ? {} : { lastError },
    }
  }

  override reindex(): DocsReindexHandle {
    if (this.build?.running === true) return this.runningHandle()
    const jobs = this.jobRuntime
    if (jobs === undefined) {
      // Without a job runtime the build still runs; it is simply not addressable
      // through the job registry, so no id is returned.
      this.build = { running: true, done: 0, total: 0 }
      void this.runBuild().catch(() => undefined)
      return {}
    }
    const id: JobId = jobs.jobs.start({
      kind: 'docsIndex',
      label: 'docs-search index build',
      run: () => {
        const settled = this.buildOnce()
        return {
          cancel: () => {},
          done: settled.then(() => ({ status: 'completed' as const })),
        }
      },
    })
    return { jobId: id }
  }

  /** Mark a build running before the job registry starts its work. */
  private buildOnce(): Promise<BuildOutcome> {
    this.build = { running: true, done: 0, total: 0 }
    return this.runBuild()
  }

  /** The job id of the build in flight, when one is both running and addressable. */
  private runningHandle(): DocsReindexHandle {
    const jobs = this.jobRuntime
    if (jobs === undefined) return {}
    const running = jobs.jobs.list().find(snapshot => snapshot.kind === 'docsIndex' && snapshot.status === 'running')
    return running === undefined ? {} : { jobId: running.id }
  }

  /**
   * Bring stored chunks in line with the corpus, embedding only changed ones.
   *
   * The build is a single-flight operation: a second caller joins the build
   * already running instead of starting a competing scan.
   * @returns the counts the build committed.
   */
  private async runBuild(): Promise<BuildOutcome> {
    const state = this.build
    try {
      const store = await this.storeHandle()
      const chunks = await scanDocsCorpus({
        root: this.config.root,
        rules: this.rules,
        maxBodyChars: this.config.maxBodyChars,
        maxCodeLines: this.config.maxCodeLines,
      })
      const pending = store.pendingCount(chunks)
      if (state !== undefined) {
        state.total = pending
        state.done = 0
      }
      const outcome = store.reconcile(chunks)
      const embedder = await this.embedderHandle()
      if (embedder !== undefined && store.vectorReady && outcome.embeddings.length > 0) {
        const vectors = await this.embedChunks(
          embedder,
          outcome.embeddings.map(entry => entry.chunk),
          state,
        )
        store.writeVectors(outcome.embeddings.map((entry, index) => ({
          id: entry.id,
          vector: vectors[index] ?? [],
        })))
      }
      this.buildFailure = undefined
      this.recordDegradation(this.degradation)
      return { changed: outcome.changed, removed: outcome.removed }
    } catch (error: unknown) {
      this.buildFailure = `index build failed: ${errorMessage(error)}`
      this.recordDegradation(this.degradation)
      throw error
    } finally {
      if (state !== undefined) state.running = false
    }
  }

  /** Embed changed chunks in configured batches, reporting progress on the build state. */
  private async embedChunks(
    embedder: DocsEmbedder,
    chunks: readonly DocsChunk[],
    state: BuildState | undefined,
  ): Promise<number[][]> {
    const vectors: number[][] = []
    for (let offset = 0; offset < chunks.length; offset += this.config.batchSize) {
      const batch = chunks.slice(offset, offset + this.config.batchSize)
      const embedded = await embedder.embedDocs(batch.map(chunk => chunk.title), batch.map(chunk => chunk.body))
      vectors.push(...embedded)
      if (state !== undefined) state.done += batch.length
    }
    return vectors
  }

  /** Rank the vector arm, returning no hits while the semantic arm is degraded. */
  private async semanticHits(
    store: DocsIndexStore,
    query: string,
    limit: number,
    kinds: readonly DocsSourceKind[],
  ): Promise<ChunkHit[]> {
    if (!store.vectorReady || this.build?.running === true) return []
    const embedder = await this.embedderHandle()
    if (embedder === undefined) return []
    const vector = await embedder.embedQuery(query)
    return store.searchSemantic(vector, limit, kinds)
  }

  /** Resolve the store, recording a load failure as the semantic arm's degradation reason. */
  private async storeHandle(): Promise<DocsIndexStore> {
    if (this.store !== undefined) return this.store
    this.opening ??= this.open()
    return this.opening
  }

  private async open(): Promise<DocsIndexStore> {
    try {
      const store = await DocsIndexStore.open(this.config.indexPath)
      const failure = await store.loadVectorExtension(this.config.dimensions)
      this.store = store
      this.recordDegradation(failure === undefined ? undefined : `sqlite-vec extension unavailable: ${failure}`)
      return store
    } catch (error: unknown) {
      this.opening = undefined
      const reason = `documentation index unavailable: ${errorMessage(error)}`
      this.recordDegradation(reason)
      throw new DocsSearchError(reason, 'DOCS_SEARCH_INDEX_FAILED', { cause: error })
    }
  }

  /** Prepare the embedder on first use; a failure degrades the semantic arm only. */
  private async embedderHandle(): Promise<DocsEmbedder | undefined> {
    if (this.embedder !== undefined) return this.embedder
    this.preparing ??= this.createEmbedder()
    return this.preparing
  }

  /**
   * Prepare the embedding backend from this provider's configuration.
   *
   * Subclasses replace this to supply an embedder without loading model
   * weights; the returned `undefined` path is the documented degradation, so an
   * override must report its reason the same way.
   * @returns the ready embedder, or undefined when the model could not be prepared.
   */
  protected async createEmbedder(): Promise<DocsEmbedder | undefined> {
    const config: DocsEmbedderConfig = {
      modelId: this.config.modelId,
      dtype: this.config.dtype,
      dimensions: this.config.dimensions,
      cacheRoot: this.config.cacheRoot,
      batchSize: this.config.batchSize,
      ...this.config.localModelPath === undefined ? {} : { localModelPath: this.config.localModelPath },
    }
    const result = await createDocsEmbedder(config)
    if (!result.ok) {
      this.recordDegradation(result.reason)
      return undefined
    }
    this.embedder = result.embedder
    this.recordDegradation(this.degradation)
    return result.embedder
  }

  /**
   * Install the embedder a subclass prepared, so an override can complete the
   * protected step without reaching into private state. The installed embedder
   * proves the semantic arm is available, so the model's own degradation reason
   * is cleared while a build failure is kept.
   * @param embedder - the prepared embedder.
   */
  protected useEmbedder(embedder: DocsEmbedder): void {
    this.embedder = embedder
    this.degradation = undefined
    this.lastError = this.buildFailure
  }

  /**
   * Install the reason the semantic arm is degraded, or clear it.
   *
   * The reason is provider state, not a log line: `status()` reports it until
   * an arm recovers, and a subclass that prepares its own embedder records its
   * failure through this hook.
   * @param reason - the active degradation reason, or undefined when both arms work.
   */
  protected recordDegradation(reason: string | undefined): void {
    this.degradation = reason
    this.lastError = this.degradation ?? this.buildFailure
  }
}

/**
 * Apply defaults and reject a configuration this provider could not run with.
 *
 * The paths are self-contained, so a missing or unusable value fails here, at
 * the loader boundary, rather than at the first search. `fp16` is refused
 * because EmbeddingGemma's fp16 export produces degenerate embeddings, and a
 * vector width outside the model's Matryoshka set cannot be truncated to.
 * @param config - loader-provided configuration.
 * @returns the resolved configuration.
 * @throws DocsSearchError with `DOCS_SEARCH_INVALID_CONFIG` naming the unsupported field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    root: config.root ?? process.cwd(),
    corpus: config.corpus ?? [],
    indexPath: config.indexPath ?? dshHomePath('docs-index', 'docs-search.sqlite'),
    cacheRoot: config.cacheRoot ?? dshHomePath('models'),
    modelId: config.modelId ?? DOCS_SEARCH_DEFAULT_MODEL_ID,
    dtype: config.dtype ?? DOCS_SEARCH_DEFAULT_DTYPE,
    dimensions: config.dimensions ?? DOCS_SEARCH_DEFAULT_DIMENSIONS,
    batchSize: config.batchSize ?? DOCS_SEARCH_DEFAULT_BATCH_SIZE,
    maxBodyChars: config.maxBodyChars ?? 8_000,
    maxCodeLines: config.maxCodeLines ?? 40,
    defaultLimit: config.defaultLimit ?? DOCS_SEARCH_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? DOCS_SEARCH_MAX_LIMIT,
    snippetChars: config.snippetChars ?? DOCS_SEARCH_SNIPPET_CHARS,
    openAtStart: config.openAtStart ?? false,
    ...config.localModelPath === undefined ? {} : { localModelPath: config.localModelPath },
  }
  if (resolved.root.trim().length === 0) throw invalidConfig('root must not be blank')
  if (resolved.indexPath.trim().length === 0) throw invalidConfig('indexPath must not be blank')
  if (resolved.modelId.trim().length === 0) throw invalidConfig('modelId must not be blank')
  if (!DOCS_SEARCH_ALLOWED_DIMENSIONS.includes(resolved.dimensions as 128 | 256 | 512 | 768)) {
    throw invalidConfig(`dimensions must be one of ${DOCS_SEARCH_ALLOWED_DIMENSIONS.join(', ')}`)
  }
  for (const rule of resolved.corpus) {
    if (rule.root.trim().length === 0) throw invalidConfig('every corpus rule needs a non-blank root')
    if (rule.suffix.trim().length === 0) throw invalidConfig('every corpus rule needs a non-blank suffix')
  }
  if (resolved.defaultLimit > resolved.maxLimit) {
    throw invalidConfig('defaultLimit must be less than or equal to maxLimit')
  }
  return resolved
}

function invalidConfig(detail: string): DocsSearchError {
  return new DocsSearchError(`docs-search config: ${detail}`, 'DOCS_SEARCH_INVALID_CONFIG')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default LocalDocsSearchService
