---
description: "The local hybrid documentation-search provider for deployments and maintainers choosing, configuring, or debugging SQLite FTS5 plus EmbeddingGemma retrieval over the repository's own docs."
kind: "package-reference"
---

# @deepseek-ai/dsh-docs-search-local

## Summary

Use this package to give `ctx.docsSearch` a working implementation that indexes this repository's own documentation, in the repository process, with no network access after the model is cached. Search is hybrid: an FTS5 BM25 arm and an EmbeddingGemma vector arm are fused with Reciprocal Rank Fusion, so a query finds both the sections that use its words and the sections that mean the same thing in different words. The index is a derived SQLite database outside the repository, and every optional asset — the store module, the `sqlite-vec` extension, the embedding model — degrades the semantic arm alone rather than failing a search.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider when a composition needs local documentation search — for example the model-facing `docs_search` tool. It registers as `ctx.docsSearch`, and every field has a default, so the smallest composition is the plugin entry alone.

```yaml
- name: '@deepseek-ai/dsh-docs-search-local'
  config:
    root: /path/to/repository
    modelId: onnx-community/embeddinggemma-300m-ONNX
```

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-docs-search-local) is the exhaustive source for every accepted field and its JSDoc.

### The corpus

A corpus rule names where files live, what suffix they carry, whether the scan recurses, and which kind every chunk from those files takes. The default corpus covers six kinds: package READMEs under `packages/`, the generated configuration and tool catalogs, `docs/subsystems/`, the user guides under `docs/user/`, and the accepted task specifications under `.specs/`.

Agent Notes under `.agents/notes/implemented/` are **not** in the default corpus. Indexing every implemented note multiplies the first build, so notes stay opt-in: a composition that wants them adds a `note` rule. The kind vocabulary accepts `note` either way, so the choice costs no code.

A chunk is one Markdown section, keyed by the kind its file belongs to. Its anchor is the heading slug a link fragment would use, and its title is the heading text — prefixed with `@deepseek-ai/dsh-<package>` for a package README. A task specification also contributes one chunk from its frontmatter `summary`. A fenced code block longer than `maxCodeLines` (default 40) is replaced by a one-line placeholder in the embedded text, which keeps a source-heavy section from dominating an embedding while leaving the section locatable.

### Where the index lives

The index is a derived SQLite database at `<dsh home>/docs-index/docs-search.sqlite` — never inside the repository. The embedding model is cached under `<dsh home>/models`. Both are configurable: set `indexPath` and `cacheRoot`. A missing directory or database file is created owner-only.

### Building the index

`ctx.docsSearch.reindex()` schedules a build and returns immediately. With a job runtime mounted the build is a `docsIndex` job and the handle carries its id; without one the build still runs and the handle is empty. Progress is observed through `ctx.docsSearch.status()`, whose `building` flag is observable as soon as `reindex()` returns.

A build is incremental by content hash: a chunk whose body hash is unchanged keeps its row, its embedding, and its lexical entry, so a repeated build over an unchanged corpus embeds nothing and re-embeds exactly the sections that changed. A chunk that vanished from the corpus is deleted. The whole reconciliation runs in one transaction, so a failed build leaves the previous index intact.

### Queries

A query is ranked by two arms. The lexical arm runs BM25 over an FTS5 table. The semantic arm embeds the query with EmbeddingGemma's query prefix and asks the `vec0` KNN index for the nearest stored vectors, which were embedded with the document prefix. The two rankings are fused with Reciprocal Rank Fusion (`k = 60`), so a chunk found by both arms outranks a chunk found by either alone without any calibration between BM25 and cosine similarity. Results carry each arm's native score.

Caller query text is treated as data. For FTS5 the query is reduced to its Unicode letter and digit runs and emitted as a quoted phrase union, so no caller input — including `AND`, `OR`, `NOT`, `*`, parentheses, or a column filter — can reach the index as syntax.

### When something is missing

Misconfiguration fails loud at the loader boundary: an unsupported `dimensions` value, a blank path, or a corpus rule without a root or suffix refuses to load. `fp16` is not an accepted `dtype` because EmbeddingGemma's fp16 export produces degenerate embeddings.

An absent optional asset degrades the semantic arm instead. A host without `node:sqlite`, without the `sqlite-vec` extension, or without the model downloaded keeps answering from the lexical arm, and `status()` reports one line explaining which asset is missing in `lastError`. The model itself is loaded lazily on the first query that needs it, and downloading it on first use is expected; set `localModelPath` to load only local weights and never contact a remote host.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the provider and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

- **Two arms, one ranking.** BM25 and vector similarity have no common scale, so the provider never compares their scores. Reciprocal Rank Fusion combines ranks, which is why a semantic-only hit and a lexical-only hit are both reachable and why results expose which arm found what.
- **Normalize after truncation.** EmbeddingGemma emits 768 dimensions and supports Matryoshka truncation to 128, 256, 512, or 768. Truncating an already-normalized vector discards the mass behind the retained dimensions and leaves it only approximately unit length, so the adapter re-normalizes after truncation. The vector arm is ranked by `1 - L2 distance`, which equals the dot product only for unit vectors.
- **Prefixes belong to the adapter.** The query and document prefixes are applied inside the embedder, so every stored chunk and every query are formatted identically and a call site cannot half-apply them.
- **The store is derived and disposable.** The database carries an application id and a schema version; a foreign database is refused, and a recognized one from another schema version is dropped in place rather than migrated.
- **`vec0` is declared after the extension loads.** The vector table cannot exist without the extension, so declaring it up front would silently produce a store with no vector table; it is created by the same step that loads `sqlite-vec`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `LocalDocsSearchService`, `Config`, config resolution, query orchestration, build lifecycle |
| [`src/chunker.ts`](src/chunker.ts) | Corpus rules, filesystem scan, Markdown section splitting, heading slugs, fence elision |
| [`src/store.ts`](src/store.ts) | SQLite open and identity, metadata/FTS5/`vec0` schema, reconciliation, lexical and semantic ranking |
| [`src/embedder.ts`](src/embedder.ts) | `DocsEmbedder` interface, transformers.js adapter, prefixes, truncate-and-normalize |
| [`src/query.ts`](src/query.ts) | FTS5 sanitization, request normalization, snippets, Reciprocal Rank Fusion |
| — | No runtime invariant companion is published; the provider's durable relation is its own derived index, whose consistency is proven by the reconciliation tests and the real Loader composition rather than observed independently at runtime. |
| `tests/stub-embedder.ts` | Deterministic hash-derived embedder used by every suite except the store's own |

### Main flow

A search normalizes the request, resolves the store (opening it and loading the extension on first use), ranks both arms over a candidate set wider than the result limit, fuses the rankings, and projects the surviving metadata rows into bounded results. A build scans the corpus, reconciles hashes in one transaction, prepares the embedder, embeds only the changed chunks in configured batches while updating progress, and writes their vectors in one transaction.

### Invariants and ownership

- Queries and stored chunks always share one width: `dimensions` decides both the `vec0` column and the adapter's output.
- A chunk is addressed by its real heading slug, so a result's `anchor` resolves back to the section it names.
- Only the changed chunks are embedded; the hash comparison is the sole input to that decision.
- The index is owned by this process on the configured path; a second process pointed at the same file is outside this contract.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [docs-search](../docs-search/README.md) — the service contract this provider implements.
- [tool-docs-search](../tool-docs-search/README.md) — the model-facing consumer.
- [session-query-sqlite](../../session-query/session-query-sqlite/README.md) — the sibling SQLite provider whose open, identity, and degradation patterns this one follows.
- [Search sources catalog](#the-corpus) — the corpus rules the default configuration applies.

-----

<a id="model-experience"></a>
## Model Experience

None, as this provider returns located sections only to its callers and registers no prompt, schema, or tool result of its own.

#### KV Cache effect

No direct invalidation; the consumer that renders these results owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this provider is a poor fit. They are current package constraints, not a roadmap.

- **One writer per index path** — two processes pointed at the same database are outside this contract; the shipped composition mounts one provider.
- **The first build is the expensive one** — every chunk is embedded once, so the initial build over the full corpus is bounded by model throughput, not by disk; `maxBodyChars` and `maxCodeLines` cap what one chunk contributes, not how many chunks exist.
- **A build is not cancellable** — a job runtime can request cancellation, but the provider's job hooks complete the current build rather than interrupting it, so a stopped deployment waits for the scan and the outstanding embedding batches.
- **Lexical recall follows the tokenizer** — the `unicode61` tokenizer matches tokens and phrases, not arbitrary substrings, so a query that only appears inside a larger token relies on the semantic arm.
- **The model download is not pinned by hash** — the runtime caches whatever the configured `modelId` publishes; an upstream re-publish changes the vectors a later build stores.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The real-model smoke is out of scope for the keyless suite: every spec substitutes a deterministic hash-derived embedder, and no test downloads weights or asserts model quality. Fusion, ranking, degradation, and incremental indexing are proven against the stub; embedding quality is not covered anywhere in this repository.

</details>