---
id: TASK:llm/task-class-model-routing
type: task
status: accepted
summary: Add the task-class model routing policy, its live OpenRouter catalog seam, and the delegation and request-path consumers that use it.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:llm/dynamic-model-routing#c-classes
  - REQ:llm/dynamic-model-routing#c-ranking
  - REQ:llm/dynamic-model-routing#c-catalog
  - REQ:llm/dynamic-model-routing#c-scope
  - REQ:llm/dynamic-model-routing#c-consumers
  - REQ:llm/dynamic-model-routing#c-durable
  - REQ:llm/dynamic-model-routing#c-adaptation
  - REQ:llm/dynamic-model-routing#c-caching
  - REQ:llm/dynamic-model-routing#c-default
  - REQ:llm/dynamic-model-routing#c-evidence
labels: [llm, routing, openrouter, delegation]
assignee: carlo
---

# Task-class model routing

## Scope

Extract the OpenRouter public catalog and pricing read that [`openrouter-spend`](../../packages/llm/openrouter-spend/README.md) performs into a shared library, and expose it to same-process consumers through a model-catalog capability. Add a routing-policy service owning deployment-declared task classes, requirement filters, and preference tiers, with a resolve operation returning a concrete selection plus its evidence.

Consume the policy from two surfaces: the spawned-subagent delegation schema, which accepts an optional `task_class` that an explicit route overrides, and an [`agent/request`](../../packages/core/agent/src/runtime-types.ts) listener that replaces a running Agent's route for a step using the capture-and-apply shape [`installModelSelection`](../../packages/core/agent/src/model-selection.ts) already establishes.

Record each resolved choice as a new ordinary session event carrying the class, policy revision, candidate count, winner, and nearest rejected cost. Keep routing disabled by default so every existing pinned route is unchanged.

Do not change the Daedal reference presets' pinned models, the OpenAI reference preset, the settings-driven per-Agent selection surface, or the Remote-only contract of the spend report.

## Acceptance

Class filtering rejects any model failing a declared requirement, including insufficient context, absent reasoning support, and a missing input modality. Ranking selects the cheapest eligible model in the highest-preference tier containing a candidate. A class with no eligible model in scope fails with a diagnostic naming the class, the provider scope, and the failing requirement, and never reaches another provider.

A delegation naming only a class resolves at child start; naming an explicit route overrides the class and behaves as it does today. A running Agent's route can be replaced for a step after assembly and before the system prompt and accepted users commit, and a route change appends the existing durable model-change notice.

With the catalog unchanged, publishing a cheaper model that matches a preferred tier changes the next resolution's winner with no configuration edit, and a model outside every declared tier is reported as an observed candidate without becoming the winner. Resolution performs no network read while the catalog and policy revisions are unchanged, and a catalog read failure follows an explicitly configured policy.

## Verification

Focused unit tests cover class requirement filtering, tier and price ranking, unsatisfiable-class failure, provider-scope containment, explicit-route precedence, catalog-change adaptation, out-of-preference rejection, decision-event recording, and memoization with no network read. A keyless recorded-session scenario pins the delegated `task_class` path and the decision event in the transcript.

`pnpm run typecheck`, focused `pnpm run test` for the touched packages, `pnpm run lint`, `pnpm run test:snapshot -t <scenario>`, and `pnpm run doc-sync` for the affected READMEs and the Agent Note. Package coverage stays at the per-file 100% gate. `spec lint` is unavailable in this environment because the forge-spec CLI is not installed; the spec files are validated by inspection instead.

Landed so far: the pure policy and the catalog seam in `packages/llm/model-routing`, with 40 focused tests at 100% statement, branch, function, and line coverage over `catalog.ts`, `index.ts`, `rank.ts`, and `spec.ts`; a clean package typecheck and oxlint run; and the regenerated `tsconfig.base.json` alias and `docs/module-graph.md`. Class filtering, tier and price ranking, deterministic tie-break, unsatisfiable-class failure, out-of-preference reporting, provider-scope containment, and revision memoization are covered.

The shared read is extracted. `packages/llm/openrouter-catalog` owns the `GET /models` parse, the price conversion, the bounded TTL cache, and the failure-mapped endpoint helper, and `packages/llm/openrouter-spend` now depends on it while keeping its authenticated `/key` half, session attribution, and USD math. The tests moved with the code; the combined suite is 106 tests, and a baseline comparison against the pre-extraction tree confirms the refactor changed no behavior and introduced no coverage regression — the subset gaps in `cache.ts`, `read.ts`, `pricing.ts`, and `service.ts` reproduce identically on the original tree.

Still outstanding: the OpenRouter catalog provider that fills `ctx.modelCatalog`, the delegation `task_class`, the request-path listener, the durable decision event, and the recorded-session snapshot.
