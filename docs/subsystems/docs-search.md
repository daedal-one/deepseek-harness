# Docs Search

Local hybrid retrieval over this repository's own documentation. The [Service Definition package](../../packages/docs/docs-search) owns the request, located-result, status, and reindex vocabulary, while the [local provider](../../packages/docs/docs-search-local) owns the corpus, the SQLite index, the embedding model, and rank fusion.

Source: [`packages/docs/docs-search/src/types.ts`](../../packages/docs/docs-search/src/types.ts)

## Corpus kinds

Every chunk belongs to exactly one corpus kind, fixed by where its file lives. A search may be restricted to one kind; `all` searches every kind.

```ts type-equiv
/**
 * Corpus a chunk was extracted from. The kind is fixed by where the file lives:
 * a package README, a generated catalog, a subsystem reference, an Agent Note,
 * a task specification, or a user guide.
 */
type DocsSourceKind = 'readme' | 'catalog' | 'subsystem' | 'note' | 'spec' | 'guide'
```

```ts type-equiv
/**
 * Requested scope of one search. `all` searches every corpus kind; any other
 * value restricts the search to that kind. A restricted search still returns
 * the same result vocabulary, so a caller can always read `source`.
 */
type DocsSearchKind = 'all' | DocsSourceKind
```

## Located results

A result identifies one Markdown section by file and anchor and carries a bounded excerpt, never a complete body. The `arms` record is how a caller distinguishes a lexical hit from a semantic one, and a chunk ranked by both carries both scores.

```ts type-equiv
/**
 * Per-arm retrieval scores attached to one result. Each arm is absent when that
 * arm contributed no ranking for the chunk, which is how a caller distinguishes
 * a lexical-only hit from a semantic-only one.
 */
interface DocsSearchArms {
  /** Provider-native lexical score, present when the full-text arm ranked this chunk. */
  lexical?: number
  /** Provider-native semantic score, present when the vector arm ranked this chunk. */
  semantic?: number
}
```

```ts type-equiv
/**
 * One located documentation section. Results locate text; they never carry a
 * complete section body, so a caller reads `file` at `anchor` for full content.
 */
interface DocsSearchResult {
  /** Corpus the section was extracted from. */
  source: DocsSourceKind
  /** Repository-relative path of the owning Markdown file. */
  file: string
  /** Markdown heading slug or package-section id that addresses the section inside `file`. */
  anchor: string
  /** Section title as extracted, without the leading `#` markers. */
  title: string
  /** Bounded plain-text excerpt from the section body. */
  snippet: string
  /** Provider-computed rank score; higher ranks first. */
  score: number
  /** Which retrieval arms ranked this result, and with what provider-native score. */
  arms: DocsSearchArms
}
```

```ts type-equiv
/** One search request over the documentation corpus. */
interface DocsSearchRequest {
  /** Caller query text. Interpreted as data, never as index or match syntax. */
  query: string
  /** Corpus kind to restrict the search to; `all` searches every kind. */
  kind?: DocsSearchKind
  /** Maximum number of results. Bounded by the provider's configured maximum. */
  limit?: number
}
```

## Index state

`status()` is a read-only observation, safe to poll while a build runs. `modelReady` reports whether the semantic arm can rank at all; `lastError` carries one line naming the asset that is missing or the build that failed.

```ts type-equiv
/**
 * Read-only observation of the index and its semantic arm. Reported before any
 * build runs, so a caller can distinguish "not built yet" from "built empty".
 */
interface DocsSearchStatus {
  /** Number of chunks currently stored in the index. */
  chunks: number
  /** Number of corpus files whose complete current content is stored, without pending or vanished chunks. */
  indexed: number
  /** Whether the embedding model loaded and the semantic arm can rank. */
  modelReady: boolean
  /** Whether an index build is running now. */
  building: boolean
  /**
   * One-line reason the semantic arm is unavailable or the last build failed,
   * absent when the index is current and both arms are available.
   */
  lastError?: string
}
```

```ts type-equiv
/** Handle returned by {@link DocsSearcher.reindex} for the scheduled build. */
interface DocsReindexHandle {
  /** Registry-issued id of the background build job, absent when no job runtime is mounted. */
  jobId?: string
}
```

## Retrieval

The lexical arm is BM25 over an FTS5 table; the semantic arm is EmbeddingGemma through `@huggingface/transformers`, truncated to a configured Matryoshka width, re-normalized after truncation, and ranked by the `vec0` KNN index. Reciprocal Rank Fusion (`k = 60`) combines the two rankings, so a chunk found by both arms outranks a chunk found by either alone without any calibration between BM25 and cosine similarity.

Queries and stored chunks share one width because `dimensions` decides both the `vec0` column and the adapter's output. The query prefix `task: search result | query: ` and the document prefix `title: <title|none> | text: ` are applied by the embedder, so a call site cannot half-apply them.

An absent optional asset degrades only the semantic arm: without the embedding model, without `node:sqlite`, or without the `sqlite-vec` extension, search still answers from the lexical arm and `status().lastError` says why. Misconfigured paths and unsupported values fail loud at the loader boundary instead.

## Index lifecycle

A chunk is one Markdown section carrying its corpus kind, repository-relative file, anchor, title, body, and a SHA-256 hash of that body. `reindex()` schedules a build and returns immediately; the build scans the corpus, compares hashes, embeds only the changed chunks, deletes the vanished ones, and writes their vectors. Because the hash is the sole input to that decision, a repeated build over an unchanged corpus embeds nothing. The reconciliation runs in one transaction, so a failed build leaves the previous index intact.

The index is a derived SQLite database at `<dsh home>/docs-index/docs-search.sqlite`, never inside the repository.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocssearch--docssearcher-abstract-seam"></a>

### `ctx.docsSearch` — `DocsSearcher` (abstract seam)

Abstract hybrid documentation search service. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as `ctx.docsSearch` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- search resolves with ranked results even while the semantic arm is degraded or an index build is running; it rejects only for a rejected request (blank query, out-of-range limit) or an unusable index.
- A result locates a section by `file` and `anchor` and carries only a bounded excerpt. The complete section body is never returned.
- reindex returns as soon as a build is scheduled. Callers observe progress through status.
- A missing embedding model, an unavailable store module, or a failed extension load degrades the semantic arm and nothing else: the reason is reported once through DocsSearchStatus.lastError.

```ts cordis-catalog
/**
 * Search the documentation corpus with lexical and semantic retrieval.
 * @param request - query text, optional corpus kind, and optional result limit.
 * @returns ranked section locations, highest score first.
 * @throws when the query is blank or `limit` is outside the provider's accepted range.
 */
abstract search(request: DocsSearchRequest): Promise<DocsSearchResult[]>

/**
 * Read the current index and semantic-arm state without mutating either.
 * @returns stored chunk and file counts, model readiness, build progress, and the last degradation reason.
 */
abstract status(): DocsSearchStatus

/**
 * Schedule an index build that brings stored chunks in line with the corpus.
 * @returns the scheduled build's background job id, absent when no job runtime is mounted.
 */
abstract reindex(): DocsReindexHandle
```

Source: [`packages/docs/docs-search/src/index.ts`](../../packages/docs/docs-search/src/index.ts)
<!-- END GENERATED cordis-surface -->