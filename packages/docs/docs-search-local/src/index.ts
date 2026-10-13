/**
 * Local Service Provider for `ctx.docsSearch`: a two-arm index over this
 * repository's own documentation corpus, stored in one SQLite database.
 *
 * The lexical arm is FTS5 BM25; the semantic arm is EmbeddingGemma through
 * `@huggingface/transformers`, truncated to a configured Matryoshka width and
 * L2-normalized after truncation. Results from both arms are fused with
 * Reciprocal Rank Fusion. Missing vectors or model assets leave lexical
 * search available; missing SQLite makes the index unavailable.
 * {@link DocsSearchStatus.lastError} reports the active failure.
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
import type { ChunkHit, StoredChunk } from './store.ts'

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
  /** Open the store at activation instead of first use. Defaults to `false`. */
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
  /** Cooperative cancellation between scans, inference calls, and commit. */
  controller: AbortController
  /** Registry identity of this provider-owned build. */
  jobId?: JobId
}

/** Local SQLite-backed hybrid documentation search provider. */
export class LocalDocsSearchService extends DocsSearcher {
  static Config = z.object({
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
  private preparationFailed = false
  private degradation: string | undefined
  private buildFailure: string | undefined
  private lastError: string | undefined
  private build: BuildState | undefined
  private disposed = false
  private readonly pending = new Set<Promise<unknown>>()
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
    ctx.effect(() => async () => {
      this.disposed = true
      this.build?.controller.abort(new Error('docs-search provider disposed'))
      await Promise.allSettled(this.pending)
      try {
        await this.embedder?.dispose()
      } finally {
        this.embedder = undefined
        this.store?.close()
        this.store = undefined
      }
    }, 'docsSearchLocal.close')
    if (this.config.openAtStart) {
      // A failure here is a degradation, not a load failure: the provider must
      // stay mounted so status() can report why the index is unavailable.
      void this.track(this.storeHandle()).catch(() => undefined)
    }
  }

  override async search(request: DocsSearchRequest): Promise<DocsSearchResult[]> {
    this.assertActive()
    return this.track(this.searchOnce(request))
  }

  private async searchOnce(request: DocsSearchRequest): Promise<DocsSearchResult[]> {
    const query = normalizeQuery(request.query)
    const limit = normalizeLimit(request.limit, this.config.defaultLimit, this.config.maxLimit)
    const kinds = filterKinds(request.kind)
    const store = await this.storeHandle()
    const expression = sanitizeFtsQuery(query)
    // Fetch a wider candidate set per arm than the result limit so fusion has
    // cross-arm evidence to work with.
    const armLimit = Math.min(limit * 4, DOCS_SEARCH_MAX_LIMIT * 4)
    const semantic = await this.semanticHits(store, query, armLimit, kinds)
    const lexical = store.searchLexical(expression, armLimit, kinds)
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
    this.assertActive()
    if (this.build?.running === true) return this.build.jobId === undefined ? {} : { jobId: this.build.jobId }
    const state: BuildState = { running: true, controller: new AbortController() }
    const jobs = this.jobRuntime
    if (jobs === undefined) {
      void this.buildOnce(state).catch(() => undefined)
      return {}
    }
    const id: JobId = jobs.jobs.start({
      kind: 'docsIndex',
      label: 'docs-search index build',
      run: () => {
        const settled = this.buildOnce(state)
        return {
          cancel: () => { state.controller.abort(new Error('docs-search build cancelled')) },
          done: settled.then(
            () => ({ status: 'completed' as const }),
            (error: unknown) => ({
              status: state.controller.signal.aborted ? 'killed' as const : 'failed' as const,
              detail: errorMessage(error),
            }),
          ),
        }
      },
    })
    state.jobId = id
    return { jobId: id }
  }

  /** Own one build until all scanning and inference has settled. */
  private buildOnce(state: BuildState): Promise<BuildOutcome> {
    this.build = state
    if (this.preparationFailed) this.preparing = undefined
    return this.track(this.runBuild(this.build))
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('docs-search provider disposed')
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }

  /**
   * Bring stored chunks in line with the corpus, embedding only changed ones.
   *
   * The build is a single-flight operation: a second caller joins the build
   * already running instead of starting a competing scan.
   * @returns the counts the build committed.
   */
  private async runBuild(state: BuildState): Promise<BuildOutcome> {
    const signal = state.controller.signal
    try {
      const store = await this.storeHandle()
      signal.throwIfAborted()
      if (!store.vectorReady) await this.prepareVectors(store)
      const chunks = await scanDocsCorpus({
        root: this.config.root,
        rules: this.rules,
        maxBodyChars: this.config.maxBodyChars,
        maxCodeLines: this.config.maxCodeLines,
      })
      signal.throwIfAborted()
      const embedder = store.vectorReady ? await this.embedderHandle() : undefined
      signal.throwIfAborted()
      const pending = embedder === undefined ? [] : store.pendingEmbeddings(chunks)
      const vectors = new Map<StoredChunk, readonly number[]>()
      if (embedder !== undefined) {
        for (let offset = 0; offset < pending.length; offset += this.config.batchSize) {
          const batch = pending.slice(offset, offset + this.config.batchSize)
          const embedded = await embedder.embedDocs(batch.map(chunk => chunk.title), batch.map(chunk => chunk.body))
          signal.throwIfAborted()
          if (embedded.length !== batch.length) throw new Error('embedding batch returned an unexpected number of vectors')
          for (const [index, chunk] of batch.entries()) vectors.set(chunk, embedded[index] as number[])
        }
      }
      signal.throwIfAborted()
      const outcome = store.reconcile(chunks, vectors)
      this.buildFailure = undefined
      this.recordDegradation(this.degradation)
      return { changed: outcome.changed, removed: outcome.removed }
    } catch (error: unknown) {
      this.buildFailure = `index build failed: ${errorMessage(error)}`
      this.recordDegradation(this.degradation)
      throw error
    } finally {
      state.running = false
    }
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
    let vector: number[]
    try {
      vector = await embedder.embedQuery(query)
    } catch (error: unknown) {
      this.recordDegradation(`embedding query failed: ${errorMessage(error)}`)
      return []
    }
    this.recordDegradation(undefined)
    return store.searchSemantic(vector, limit, kinds)
  }

  /** Resolve the store, recording failures for both retrieval arms. */
  private async storeHandle(): Promise<DocsIndexStore> {
    if (this.store !== undefined) return this.store
    this.opening ??= this.open()
    return this.opening
  }

  private async open(): Promise<DocsIndexStore> {
    try {
      const store = await DocsIndexStore.open(this.config.indexPath)
      this.store = store
      await this.prepareVectors(store)
      return store
    } catch (error: unknown) {
      this.opening = undefined
      const reason = `documentation index unavailable: ${errorMessage(error)}`
      this.recordDegradation(reason)
      throw new DocsSearchError(reason, 'DOCS_SEARCH_INDEX_FAILED', { cause: error })
    }
  }

  private async prepareVectors(store: DocsIndexStore): Promise<void> {
    const identity = JSON.stringify([
      this.config.modelId, this.config.dtype, this.config.dimensions,
      this.config.localModelPath, 'embeddinggemma-mean-normalized-v1',
    ])
    const failure = await store.loadVectorExtension(this.config.dimensions, identity)
    this.recordDegradation(failure === undefined ? undefined : `sqlite-vec extension unavailable: ${failure}`)
  }

  /** Prepare the embedder on first use; a failure degrades the semantic arm only. */
  private async embedderHandle(): Promise<DocsEmbedder | undefined> {
    if (this.embedder !== undefined) return this.embedder
    this.preparing ??= this.createEmbedder().then((embedder) => {
      this.preparationFailed = embedder === undefined
      return embedder
    })
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
    this.useEmbedder(result.embedder)
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
 * Blank paths and unsupported values fail here at the loader boundary.
 * Filesystem availability is checked when the provider opens or scans them. `fp16` is refused
 * because EmbeddingGemma's fp16 export produces degenerate embeddings, and a
 * vector width outside the model's Matryoshka set cannot be truncated to.
 * @param config - loader-provided configuration.
 * @returns the resolved configuration.
 * @throws DocsSearchError with `DOCS_SEARCH_INVALID_CONFIG` naming the unsupported field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const validated = LocalDocsSearchService.Config(config)
  const resolved: ResolvedConfig = {
    root: config.root ?? process.cwd(),
    corpus: config.corpus ?? [],
    indexPath: config.indexPath ?? dshHomePath('docs-index', 'docs-search.sqlite'),
    cacheRoot: config.cacheRoot ?? dshHomePath('models'),
    modelId: config.modelId ?? DOCS_SEARCH_DEFAULT_MODEL_ID,
    dtype: validated.dtype,
    dimensions: validated.dimensions,
    batchSize: validated.batchSize,
    maxBodyChars: validated.maxBodyChars,
    maxCodeLines: validated.maxCodeLines,
    defaultLimit: validated.defaultLimit,
    maxLimit: validated.maxLimit,
    snippetChars: validated.snippetChars,
    openAtStart: validated.openAtStart,
    ...config.localModelPath === undefined ? {} : { localModelPath: config.localModelPath },
  }
  if (resolved.root.trim().length === 0) throw invalidConfig('root must not be blank')
  if (resolved.indexPath.trim().length === 0) throw invalidConfig('indexPath must not be blank')
  if (resolved.cacheRoot.trim().length === 0) throw invalidConfig('cacheRoot must not be blank')
  if (resolved.localModelPath?.trim().length === 0) throw invalidConfig('localModelPath must not be blank')
  if (resolved.modelId.trim().length === 0) throw invalidConfig('modelId must not be blank')
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
