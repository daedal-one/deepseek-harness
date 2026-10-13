# Agent Note: Local hybrid docs search

Status: implemented

## Problem

An agent working in this repository had no way to find where a topic is documented except by grepping the tree or reading whichever files its context already carried. The corpus that answers these questions is large, spread across several documentation tiers, and written in prose that does not share vocabulary with the question: a package README explains "the seam registers one implementation per context", while the question is "how do I add a provider". Retrieval keyed on literal tokens misses those matches entirely.

The repository is also the wrong place to send a query. Search had to stay local — no external embedding API, no credential, no network round trip — while still closing the vocabulary gap that pure text matching cannot.

## Decision

The documentation-search capability seam ships as two packages in a new `docs/` group.

[`dsh-docs-search`](../../../../packages/docs/docs-search/README.md) is the Service Definition. It owns `ctx.docsSearch` and freezes four things: a search request carrying query text, an optional corpus kind, and an optional limit; a located result carrying the corpus kind, repository-relative file, section anchor, title, a bounded snippet, a fused score, and the per-arm scores; a status observation carrying chunk and file counts, model readiness, build progress, and one degradation reason; and a reindex handle. Loading the abstract definition alone throws, so a composition that names the definition instead of a provider fails at load.

A result carries `arms` rather than one score because the fusion is provider-owned while "which retrieval paths found this" is what a caller needs to judge a hit. A result carries `anchor` rather than the section body because the caller already has the file, and returning bodies would duplicate content the repository owns and inflate every result.

[`dsh-docs-search-local`](../../../../packages/docs/docs-search-local/README.md) is the provider. It chunks the corpus at Markdown section granularity, keyed by the kind of file the section lives in: package READMEs, the generated configuration and tool catalogs, `docs/subsystems/`, the user guides, and the accepted task specifications. Each chunk hashes its kind, title, and body. Builds prepare changed or missing embeddings before one transaction commits all metadata, lexical entries, vectors, and deletions. This keeps failed inference from marking incomplete content as indexed and allows a lexical-only index to recover its semantic entries. Model identity changes invalidate only vectors. Markdown parsing and occupied heading slugs come from maintained libraries so repeated headings remain addressable.

Retrieval is two-armed. The lexical arm is FTS5 BM25. The semantic arm is EmbeddingGemma through `@huggingface/transformers`, truncated to a configured Matryoshka width, re-normalized after truncation, and ranked through a `sqlite-vec` `vec0` KNN index. Reciprocal Rank Fusion (`k = 60`) combines the rankings, giving each chunk a contribution from every arm that ranks it without calibrating BM25 against cosine similarity.

Three details are fixed rather than configurable, because getting them wrong silently degrades recall. The document and query prefixes are applied inside the embedder, so no call site can half-apply them. Truncated vectors are re-normalized after truncation, because truncating an already-normalized 768-dimension vector discards the mass behind the retained dimensions and a dot-product arm must compare unit vectors. `fp16` is not an accepted `dtype`, because EmbeddingGemma's fp16 export produces degenerate embeddings.

The index is a derived SQLite database at `<dsh home>/docs-index/docs-search.sqlite` — never inside the repository — carrying an application id and a schema version. A foreign database is refused; a recognized one from another schema version is dropped in place rather than migrated.

Failure is split by what is misconfigured. Paths and unsupported values are self-contained, so they fail loud at the loader boundary. Missing model weights or `sqlite-vec` degrade the semantic arm; unavailable SQLite prevents both arms from searching. `status().lastError` names the failure.

## Alternatives considered

**Pure-grep retrieval.** Grep needs no model, no index, and no build, and it is already available. It lost on vocabulary-gap recall: the corpus answers questions in different words than it asks them, and a lexical-only rank cannot reach "how do I add a provider" from a section that only says "the seam registers one implementation per context". The tokenizer bound is real and recorded in the package README's known limitations — a token inside a larger token is unreachable lexically and relies on the semantic arm.

**An external embedding API.** A hosted embedding endpoint would remove the model download, the ONNX runtime, and the vector extension from the deployment. It lost on the local-only requirement: it adds a credential to hold, a network round trip to every query, and a third party that sees the query text. The seam is provider-shaped precisely so such a provider can be added later without changing the contract, but it is not what shipped.

**Notes in the default corpus.** `.agents/notes/implemented/` is the tier that carries the *why* behind the corpus, so indexing it by default is tempting. It was deferred on index-build cost rather than on value: the tree holds hundreds of notes, and including them multiplies the first build and the storage for every deployment, including those that only ever search package READMEs. The `note` kind stays in the vocabulary and a composition opts in with one corpus rule, so the choice costs no code.

**Returning section bodies in results.** A result carrying the full section would save the caller a file read. It lost because the caller already has the file and the anchor, and because unbounded bodies would make every result's size depend on the corpus rather than on the request. Results carry a bounded snippet, and `maxBodyChars` and `maxCodeLines` cap what any one chunk contributes to the index.

**A single fused score.** Collapsing the arms into one number would simplify the result type. It lost because the fusion is provider-owned and a caller judging a hit needs to know whether it surfaced lexically or semantically — a semantic-only hit on a query the text never contains is exactly the case this seam exists to serve.

**Migrating the index across schema versions.** An in-place migration would preserve embeddings across a schema change. It lost because the index is a derived artifact: it can be rebuilt from the corpus at any time, so a version mismatch drops it in place rather than carrying migration code for data that is cheaper to regenerate.

## Consequences

A deployment that mounts the provider gets local search with no credential and no network access after the model is cached. The first build is the expensive one — every chunk is embedded once — and it is bounded by model throughput rather than disk; later builds cost only the sections that changed.

The semantic arm is optional at runtime in a way the contract makes observable rather than hidden. A host without the ONNX runtime, without `sqlite-vec`, or without the model downloaded keeps working and says why in `status().lastError`, which is the same degradation philosophy the sibling SQLite session-search provider applies.

Cancellation and disposal prevent a build from committing but wait for outstanding native inference. The provider retains ownership until model preparation, searches, and builds settle, then releases the model and database. Model loading uses per-instance options to avoid changing other providers’ runtime settings. Model downloads are not pinned by hash; deployments replacing weights under an unchanged model identity must rebuild with a fresh index.

The corpus default is a policy the repository can revisit without touching code: the rules are a validated `Config` list, and `.agents/notes/implemented/` is the one corpus the default deliberately leaves out.

## Testing

`packages/docs/docs-search/tests` pins the definition's contract — that the abstract service refuses to mount and that a concrete subclass registers as `ctx.docsSearch`.

`packages/docs/docs-search-local/tests` covers chunking across every corpus kind with anchor-resolution assertions that locate each chunk's anchor back in its file, incremental re-index proven by stub embedder call counts (an unchanged corpus embeds nothing, one changed section re-embeds exactly one chunk), hybrid fusion surfacing a lexical-only and a semantic-only hit, FTS5 sanitization of operator-shaped input, kind filtering, degradation on a missing model, snippet bounds in code points, store schema identity and rollback, and the truncate-and-normalize invariant. `tests/loader-composition.spec.ts` boots a test-only `cordis.yml` through the vendored Loader and asserts the loaded service's configured limits, corpus rules, and results.

The real-model smoke is out of scope for the keyless suite: every spec substitutes a deterministic hash-derived embedder, so fusion, ranking, degradation, and incremental indexing are proven without downloading weights. Embedding quality is not covered by any test in this repository.
