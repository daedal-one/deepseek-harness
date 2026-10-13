---
description: "The local hybrid documentation-search service for consumers and provider authors: search requests, located section results, index status, and the reindex handle."
kind: "package-reference"
---

# @deepseek-ai/dsh-docs-search

## Summary

`dsh-docs-search` lets application code search the repository's own documentation and get back the exact file and section anchor of each match, plus a bounded excerpt and the score each retrieval arm contributed. It is a contract only: a provider such as `dsh-docs-search-local` owns the corpus, the index, the embedding model, and ranking, and registers on the same `ctx.docsSearch` service. Results locate text; they never carry a complete section body, so a caller reads the file at the anchor when it needs full content.

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

Use `ctx.docsSearch` from application code when you need to find where a topic is documented without walking the tree yourself. The service is provided by a concrete provider plugin — the shipped composition mounts `@deepseek-ai/dsh-docs-search-local` ([README](../docs-search-local/README.md)) — so this package is never mounted alone. Everything below is available on `ctx.docsSearch` once a provider is composed.

### What you can do

| Operation | What you get |
|---|---|
| `search(request)` | Ranked section locations for one query, optionally restricted to one corpus kind |
| `status()` | Stored chunk and file counts, model readiness, build progress, and the last degradation reason |
| `reindex()` | A scheduled build that brings the index in line with the corpus |

### Searching

A request carries the caller's query text, an optional corpus kind, and an optional limit. Each result names the corpus the section came from, the repository-relative file, the anchor that addresses the section inside that file, the section title, a bounded excerpt, a fused rank score, and the per-arm scores.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-docs-search'

export async function printDocs(ctx: Context): Promise<void> {
  const hits = await ctx.docsSearch.search({ query: 'reciprocal rank fusion', kind: 'note', limit: 5 })
  for (const hit of hits) console.log(`${hit.file}#${hit.anchor} — ${hit.title}`)
}
```

The `arms` field is how a caller distinguishes retrieval paths: `lexical` is present when the full-text arm ranked the chunk, `semantic` when the vector arm did, and a chunk ranked by both carries both scores. A deployment with no embedding model still answers, and its results carry `lexical` alone.

### Reading status and rebuilding

`status()` is a read-only observation, so it can be polled while a build runs. `modelReady` reports whether the embedding model is loaded, `building` reports whether an index build is in progress, and `lastError` carries one line explaining why the semantic arm is degraded or why the last build failed.

`reindex()` returns as soon as a build is scheduled; with a job runtime mounted it returns the background job id, and without one it returns an empty handle and the build still runs. Progress is observed through `status()`. A search issued during a build still answers.

`reindex()` can throw if the provider is disposed or the job registry refuses admission. `search()` rejects invalid requests and unusable indexes; `status()` exposes the most recent build failure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains why the seam is shaped this way; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The definition owns only what a provider and a consumer must agree on: the request, the located result, the status observation, and the reindex handle. Corpus rules, chunk shapes, the store, the embedding model, and ranking stay in the provider, so a second provider can index a different corpus without changing this contract.

Two decisions in the vocabulary are deliberate. A result carries `arms` rather than a single score because the fusion that produced the ranking is provider-owned, while "which retrieval paths found this" is what a caller needs to judge a hit. A result carries `anchor` rather than the section body because the caller already has the file, and returning bodies would duplicate content the repository owns and inflate every result.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the abstract `DocsSearcher` service and its contract |
| [`src/types.ts`](src/types.ts) | Shared vocabulary: `DocsSearchRequest`, `DocsSearchResult`, `DocsSearchStatus`, `DocsSourceKind` |
| — | No runtime invariant companion is published; this package holds no mutable state and observes no event sequence, so there is no independently maintained relation for a `./invariant` entry to compare. |

### The service contract

A provider subclasses `DocsSearcher` and is loaded as a plugin; it registers as `ctx.docsSearch`. Loading the abstract class itself throws, so a composition that names this package instead of a provider fails at load rather than registering a service with no implementations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [docs-search-local](../docs-search-local/README.md) — the shipped provider: corpus, SQLite store, embedding model, and hybrid ranking.
- [tool-docs-search](../tool-docs-search/README.md) — the model-facing consumer over this seam.
- [session-query](../../session-query/session-query/README.md) — the sibling retrieval seam whose service-definition/provider split this one follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package returns located sections only to its callers and registers no prompt, schema, or tool result of its own.

#### KV Cache effect

No direct invalidation; the consumer that renders these results owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints, not a roadmap.

- **Not mountable alone** — this package defines a contract with no implementation; a composition must mount a provider or `ctx.docsSearch` never registers.
- **No pagination** — `search()` returns one bounded page with no cursor; a future scope that needs paging adds it to this contract rather than to a provider.
- **No version or freshness signal in results** — a result identifies a section by file and anchor but carries no revision, so a caller that caches results across a corpus change must invalidate them itself.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>