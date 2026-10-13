---
id: TASK:docs/local-hybrid-docs-search
type: task
status: accepted
summary: Search this repository's own documentation locally with a fused lexical and semantic index.
owners: [carlo]
progress: done
addresses: []
labels: [docs, search, sqlite, embeddings]
assignee: carlo
---

# Local hybrid docs search

## Acceptance

The documentation-search capability seam exists as a Service Definition at `packages/docs/docs-search` and a local provider at `packages/docs/docs-search-local`. The definition owns one request, one located result, one status observation, and one reindex handle on `ctx.docsSearch`; it registers nothing until a provider is mounted, and loading the abstract definition alone fails loud.

The provider indexes this repository's own documentation into a derived SQLite database rooted outside the repository — by default `<dsh home>/docs-index/docs-search.sqlite`. The corpus covers package READMEs under `packages/`, the generated configuration and tool catalogs, `docs/subsystems/`, `docs/user/`, and `.specs/`. Agent Note indexing is not enabled by default because it multiplies the first build; a composition opts in with a `note` corpus rule.

A chunk is one Markdown section keyed by its corpus kind, carrying a repository-relative file, a heading-slug anchor that resolves back to the section, a title that names the package for a package README, the body text, and a SHA-256 hash of its kind, title, and body. A fenced code block longer than the configured bound is elided from the embedded text through a one-line placeholder while the section stays locatable.

A build compares stored hashes with the scanned corpus, stages embeddings for new, changed, and missing-vector chunks before atomically committing metadata, lexical entries, vectors, and deletions, so a repeated build over an unchanged corpus embeds nothing and a failed build leaves the previous index intact. A build runs as a background job when a job runtime is mounted and as provider-owned background work otherwise, and reports whether it is running through `status()`.

A query is ranked by an FTS5 BM25 arm and an EmbeddingGemma vector arm, fused with Reciprocal Rank Fusion. Caller query text is sanitized into quoted phrases so no input reaches FTS5 as syntax. Stored chunks and queries are embedded with the model's document and query prefixes, truncated to a configured Matryoshka width, and L2-normalized after truncation. Results are bounded to a configured snippet length, carry each arm's native score, and locate a section rather than returning its body.

Misconfigured paths and unsupported values fail loud at the loader boundary. A missing embedding model or failed `sqlite-vec` load degrades the semantic arm alone and records the reason in `status().lastError`; unavailable SQLite makes the whole index unavailable. Explicit reindex retries unavailable assets and repairs missing vectors even when the corpus is unchanged. Embedding failure preserves the previous complete index. Provider disposal rejects new work, cancels builds before commit, waits for outstanding operations, and releases the model and database. Job cancellation waits for the current inference call and prevents the cancelled build from committing. Model loading uses instance-specific options without mutating process-global settings.

Repeated headings use occupied GitHub fragments, rendered Markdown heading text determines the slug, and preamble or frontmatter excerpts use the document locator. The real default corpus must index without duplicate keys and every nonempty returned anchor must resolve in its source document.
