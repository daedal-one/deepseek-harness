---
description: "The docs group map: model-facing search over the repository documentation, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/docs

## Summary

The docs group lets agents find their way around the repository's own documentation: one model-facing `docs_search` tool returns ranked section locators with bounded excerpts across READMEs, package catalogs, subsystem pages, agent notes, specs, and guides, and the model reads the file at the anchor for the full text. The tool is the Consumer of the documentation-search capability seam (`ctx.docsSearch`); retrieval and index state belong to the service packages it consumes.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`docs-search`](docs-search/README.md) | Documentation-search service contract: requests, located section results, status, and the reindex handle | `ctx.docsSearch` |
| [`docs-search-local`](docs-search-local/README.md) | Local hybrid provider: corpus chunking, SQLite FTS5 + `sqlite-vec` index, EmbeddingGemma embeddings | registers on `ctx.docsSearch` |
| [`tool-docs-search`](tool-docs-search/README.md) | Lets the agent locate repository documentation sections by query and read the file at the anchor | consumes `ctx.docsSearch`, registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Docs search subsystem reference](../../docs/subsystems/docs-search.md) — corpus kinds, chunk identity, result and status vocabulary, and the Cordis API.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-docs-search) — the `docs_search` schema the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-tool-docs-search) — every accepted config field.
- [docs_search tool Agent Note](../../.agents/notes/implemented/feature/2026-10-09-docs-search-tool.md) — the tool's design, alternatives, and the disabled-by-default bundle posture.
- [Local hybrid docs search Agent Note](../../.agents/notes/implemented/feature/2026-10-09-local-hybrid-docs-search.md) — why retrieval is local and hybrid, and what each rejected alternative would have cost.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The seam's Service Definition and local provider packages mount in this group beside the Consumer tool and own the retrieval contracts the tool README links to; their package READMEs are the home for index, embedding-model, and reindex behavior.

</details>
