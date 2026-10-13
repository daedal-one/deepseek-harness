---
description: "The model-facing docs_search tool over the DeepSeek Harness documentation-search seam: locate-then-read retrieval across READMEs, catalogs, subsystem pages, notes, specs, and guides, for users and maintainers choosing, configuring, or debugging the tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-docs-search

## Summary

Give the agent `docs_search` to locate relevant documentation sections before reading their files. Results include a file path, heading anchor, relevance score, and bounded excerpt. Choose this tool when agents need to navigate a configured documentation corpus; a mounted search provider supplies the index and ranking. Result-count and snippet budgets bound how much context each search adds.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when the agent should find its way around the harness documentation itself: locating the subsystem page that explains a seam, the spec that owns a behavior, or the agent note that records a decision. The tool returns locators and excerpts; the model then reads the file at the anchor for the full text, so search results never become a second copy of the documentation in context.

### When to choose it

Choose it for agents that work inside this repository and benefit from finding documentation before acting — development agents, documentation writers, maintainers. It needs a `ctx.docsSearch` service in the composition (the local indexer package): a profile that mounts this tool without a provider refuses to load the tool rather than answering from nothing. Skip it for agents that never work in this repository, or where the file-reading tools plus a directory listing are enough.

### Minimal configuration

Both fields have defaults; a composition that states none gets the schema-level bounds unchanged.

```yaml
- name: '@deepseek-ai/dsh-docs-search-local'
- name: '@deepseek-ai/dsh-tool-docs-search'
  config:
    resultLimitCap: 20
    snippetChars: 120
```

| Field | Default | Meaning |
|---|---|---|
| `resultLimitCap` | `50` | Maximum forwarded `limit`; an explicit model limit above the cap is rejected with a message naming the cap |
| `snippetChars` | `200` | Per-hit snippet budget in characters, enforced on the returned value so the model-visible excerpt stays bounded |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-docs-search) is the exhaustive source for the accepted fields.

### What each call does

The agent sends a query (1–512 characters), an optional single-source `kind` restriction, and an optional `limit` (1–50). The tool validates the bounds the schema cannot express, reads `status()` and runs `search()` on the `ctx.docsSearch` service, and returns the ranked hits: each hit keeps the service's `source`, `file`, anchor, `title`, fused `score`, and per-arm readings, while the snippet is re-bounded to `snippetChars` and the hit list is capped at the requested `limit`. The rendered result is one markdown list item per hit — the locator line plus its one-line snippet — preceded by a lexical-only caveat while the index is building, and closed by the read-the-file instruction whenever something hit. Calls fail visibly when the query is empty or over-long, when a `limit` leaves 1–50 or exceeds the configured cap, or when the service reports an error.

### Single consumer of a frozen contract

The tool calls the service contract exactly as frozen — `search()`, `status()`, and nothing else. It never reads files itself, never re-ranks, and never talks to the embedding model; every retrieval-quality question belongs to the provider packages. The model-facing `docs_search` surface is the only thing this package adds.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The tool is built on four commitments:

- **Locate-then-read.** The result is a set of locators with bounded excerpts; the final render line sends the model to the file at the anchor. Returning full section text was rejected deliberately — it would trade byte-budget discipline for convenience the file-reading tools already provide.
- **Bounded where the complete result is known.** The snippet budget and the limit cap are enforced on the canonical value the tool returns, so the model-visible render and the persisted result agree about what survived the bounds.
- **Explicit over silent.** An explicit limit above the deployment cap is rejected with the cap named, not silently clamped; the model gets exact feedback and can re-issue.
- **The seam owns retrieval, the Consumer owns presentation.** Ranking, truncation to `limit`, index health, and the building flag come from `ctx.docsSearch`; schema, bounds, and markdown stay here.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, load-time budget validation, `docs_search` registration |
| [`src/format.ts`](src/format.ts) | Pure validation, snippet bounding, and the bounded markdown render |
| [`src/types.ts`](src/types.ts) | Package-owned type declarations: the tool's argument and canonical-result shapes |
| — | No runtime invariant companion is published; the tool owns no independently maintained mutable relation. |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `Config` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Service seam

The `docsSearch` injection is declared, so composition is the enforcement: a profile that mounts this plugin without a documentation-search provider leaves the fiber pending and the `docs_search` tool never registers. The request, hit, and status vocabulary and the `Context.docsSearch` declaration are imported type-only from the Service Definition package (`@deepseek-ai/dsh-docs-search`), so the Consumer restates none of the seam. Within a mounted tool, the synchronous `status()` read and the awaited `search()` happen in one execute pass — a service that rejects the search fails the call loudly instead of degrading silently. The `status()` reading exists for exactly one consumer decision: the building caveat on the rendered result.

### Runtime invariants

This package publishes no `./invariant`: it owns no durable state and no relationship that independent observations could diverge on — the bounds are enforced where the complete result is known, and the service's index state belongs to the service packages.

### Call mechanics

Each call validates the schema-invisible bounds (non-whitespace query within 512 code points, `limit` within 1–50 and within the cap), forwards `{ query, kind?, limit? }` with exactly the fields the model sent, slices the service's hits to the requested limit, re-bounds every snippet on code points so a cut never splits a surrogate pair, and returns `{ hits, building }`. See [src/index.ts](src/index.ts) for the exact steps.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Docs Search subsystem](../../../docs/subsystems/docs-search.md) — the seam's request, result, status, and reindex vocabulary.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-docs-search) — the `docs_search` schema the model receives.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-docs-search) — every accepted config field and its source declaration.
- [docs group map](../README.md) — the sibling group page and the service packages behind the seam.
- [docs_search tool Agent Note](../../../.agents/notes/implemented/feature/2026-10-09-docs-search-tool.md) — the design, alternatives, and the disabled-by-default bundle posture.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`docs_search` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-docs-search): an object with a required `query` string, an optional `kind` enum over `all` plus the six documentation sources, and an optional `limit` integer. The 1–512 query and 1–50 limit bounds are enforced in `execute` and stated in the parameter guidance, because the schema DSL does not carry length or range constraints. The description is fixed prose:

##### Verbatim text for this field, when needed

```markdown
Search the repository documentation (READMEs, package catalogs, subsystem pages, agent notes, specs, and guides) for sections relevant to a query. Returns a bounded list of hits, each with its file, anchor, and a one-line snippet. Use it to locate where something is documented, then read the file at the anchor for the full text — the snippets are excerpts, not substitutes.
```

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are stable for a given configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the query and any `kind`/`limit` the model sent. Success renders one markdown list item per hit — `- <title> — <file>#<anchor> (<source>, score <S.SS>)` plus a two-space-indented one-line snippet — preceded by `The documentation index is still building; these results are lexical-only meanwhile.` when `status()` reports a build, replaced by `No documentation matches the query.` when nothing hit, and closed by `Read the file at the anchor for the full text.` whenever at least one hit rendered. Stable failures are `Error: invalid query: must be a non-empty string`, `Error: invalid query: must be at most 512 characters`, `Error: invalid limit: must be between 1 and 50`, `Error: invalid limit: exceeds the configured result limit cap (<cap>)`, and the registry's own argument-validation errors for an unknown `kind` or a non-integer `limit`.

#### Token effect

Token growth is bounded per call: at most `limit` hits, each one locator line plus a snippet of at most `snippetChars` characters, plus at most three framing lines (caveat, no-match, or final line). The canonical result the session log retains is the same bounded shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Retrieval quality is the service's contract, not this tool's** — ranking, embedding readiness, and index freshness come from the `ctx.docsSearch` provider packages; this Consumer only bounds and renders what the service returns.
- **Search is the only model-facing operation** — `status()` is read only for the building caveat and `reindex()` has no model-facing surface; index control belongs to composition and service-level tooling.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: a structured result card

The pending call presents a generic search card; the completed result falls back to the raw bounded markdown because no existing card kind honestly renders document hits (the `search` card is line-match shaped, the `web` card is web-retrieval shaped). If a documentation card kind is ever added to `dsh-tools`, the result view derives from `presentationMeta` like the grep/glob cards do.

</details>
