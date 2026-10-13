# Agent Note: The model-facing docs_search Consumer tool

Status: implemented

## Problem

An agent working inside this repository needs to find where a behavior, seam, or decision is documented without reading whole files. The documentation-search capability seam (`ctx.docsSearch`) defines a hybrid index over six documentation sources — READMEs, package catalogs, subsystem pages, agent notes, specs, and guides — but the seam had no Consumer: nothing turned the frozen service contract into a model-facing tool, and the locate-then-read discipline (ranked locators with bounded excerpts, then read the file at the anchor) had no owner.

## Decision

`packages/docs/tool-docs-search` (`@deepseek-ai/dsh-tool-docs-search`) registers the `docs_search` tool. The plugin declares `inject: ['tools', 'docsSearch']` and calls the service's frozen contract exactly — `search({ query, kind?, limit? })` for ranked hits and `status()` for the building flag — and never reads files or ranks anything itself.

Consumer-owned decisions:

- **Model-facing schema**: required `query` (1–512 characters, hand-checked in `execute` because the parameter DSL carries no length constraints), optional `kind` enum over `all` plus the six sources, optional `limit` integer 1–50.
- **Deployment budgets are validated Config**: `resultLimitCap` (default = the schema maximum, 50) and `snippetChars` (default 200). An explicit `limit` above the cap is rejected with a message naming the cap; snippets are re-bounded on Unicode code points on the canonical value, so the rendered text and the persisted result agree about what survived the bounds.
- **Result format**: a bounded markdown list — one item per hit rendering `- <title> — <file>#<anchor> (<source>, score <S.SS>)` plus a two-space-indented one-line snippet — preceded by the lexical-only caveat while `status().building`, replaced by a no-match line when nothing hit, and closed by the `Read the file at the anchor for the full text.` instruction whenever something hit.
- **Composition enforcement**: the declared `docsSearch` injection keeps the plugin fiber pending without a provider, so a composition that mounts the tool without the service never registers `docs_search` instead of failing per call.
- **Bundle posture**: the base bundle ships both the local provider row (`docs-search-local`) and this Consumer row (`tool-docs-search`) as `disabled: true` (the skill-badge/enforcer disabled-row precedent), so no shipped profile enables the capability and enabling needs no extra install.
- **UI presentation**: a pending call presents the generic card with kind `search` and the query as raw input; the completed result keeps the generic fallback, and the canonical value stays the programmatic API (`{ hits, building }`).

Acceptance governance: the capability's task spec (`.specs/tasks/local-hybrid-docs-search.spec.md`, owned by the parallel service stream) did not exist when this package landed, so this note records the Consumer tool's acceptance rather than a competing spec file.

## Contract sourcing

The Consumer imports its request, hit, and status vocabulary type-only from the Service Definition package (`@deepseek-ai/dsh-docs-search`), and the `Context.docsSearch` augmentation is that package's declaration — the Consumer restates none of the seam, and its composition test subclasses the real `DocsSearcher` base class. While the Service Definition package was not yet importable from this stream, `src/types.ts` briefly restated the frozen contract; that interim view was swapped to package-owned shapes (the tool's argument and canonical-result types) in the same change.

## Alternatives considered

- **Returning full section text from the tool** — lost: byte-budget discipline. Full sections would make one broad search cost unbounded context and duplicate the file-reading tools; locators plus bounded snippets keep one call cheap and push the model to read exactly the section it needs.
- **Default-on in shipped profiles** — lost: first-use model download cost. The semantic arm's embedding model downloads and the index builds on first use, so a default-on base profile would pay that cost for every deployment, including ones that never search the documentation.
- **Clamping an over-cap limit instead of rejecting** — lost: explicit feedback. A silent clamp returns fewer hits than the model asked for with no explanation; rejecting names the configured cap so the model can re-issue inside it.
- **Duplicating the seam vocabulary in the Consumer** — lost: one home per fact. The request, hit, and status types and the `Context` declaration belong to the Service Definition package; the Consumer imports them and keeps only its own argument and canonical-result shapes.

## Consequences

- The tool's behavior is pinned by package vitest through a real Loader composition (a test-only `docsSearch` provider, cordis.yml boot, `ctx.tools.execute`): exact render text, bounded canonical value, building line, verbatim request passthrough, cap rejection, load-time budget failures, the service-absent refusal, and the registry HMR-safety disposal test.
- The base bundle's dependency surface names both packages, and the tool-catalog boot manifest carries the Consumer with an inert contract stub for schema harvest; the workspace aliases for the seam, the provider, and this Consumer are generated from their manifests.
- Model-visible text (description, render lines, failure messages) is pinned verbatim in tests and the README; changing any of it is a coordinated change across the tool, its tests, and the README.
