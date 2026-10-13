---
id: TASK:docs/local-hybrid-docs-search
type: task
status: accepted
summary: Search this repository's own documentation locally with a fused lexical and semantic index.
owners: [carlo]
progress: in-progress
addresses: []
labels: [docs, search, sqlite, embeddings]
assignee: carlo
---

# Local hybrid docs search

## Acceptance

The documentation-search capability seam exists as a Service Definition at `packages/docs/docs-search` and a local provider at `packages/docs/docs-search-local`. The definition owns one request, one located result, one status observation, and one reindex handle on `ctx.docsSearch`; it registers nothing until a provider is mounted, and loading the abstract definition alone fails loud.

The provider indexes this repository's own documentation into a derived SQLite database rooted outside the repository — by default `<dsh home>/docs-index/docs-search.sqlite`. The corpus covers package READMEs under `packages/`, the generated configuration and tool catalogs, `docs/subsystems/`, `docs/user/`, and `.specs/`. Agent Note indexing is not enabled by default because it multiplies the first build; a composition opts in with a `note` corpus rule.

A chunk is one Markdown section keyed by its corpus kind, carrying a repository-relative file, a heading-slug anchor that resolves back to the section, a title that names the package for a package README, the body text, and a SHA-256 hash of that body. A fenced code block longer than the configured bound is elided from the embedded text through a one-line placeholder while the section stays locatable.

A build compares stored hashes with the scanned corpus, embeds exactly the new and changed chunks, and deletes the vanished ones inside one transaction, so a repeated build over an unchanged corpus embeds nothing and a failed build leaves the previous index intact. A build runs as a background job when a job runtime is mounted and inline otherwise, and reports progress through `status()`.

A query is ranked by an FTS5 BM25 arm and an EmbeddingGemma vector arm, fused with Reciprocal Rank Fusion. Caller query text is sanitized into quoted phrases so no input reaches FTS5 as syntax. Stored chunks and queries are embedded with the model's document and query prefixes, truncated to a configured Matryoshka width, and L2-normalized after truncation. Results are bounded to a configured snippet length, carry each arm's native score, and locate a section rather than returning its body.

Misconfigured paths and unsupported values fail loud at the loader boundary. An absent optional asset — a missing embedding model, an unavailable `node:sqlite`, or a failed `sqlite-vec` load — degrades the semantic arm alone and records one line of reason in `status().lastError`, while search keeps answering from the lexical arm.
