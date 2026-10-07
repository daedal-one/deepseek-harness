# Agent Note: Task-class model routing

Status: proposed

## Problem

Every model route in the Daedal reference is pinned by hand at composition time. Each named role in [`agent.cordis.yml`](../../../../docs/reference/daedal/preset/agent.cordis.yml) carries a literal `agentOptions.model`, the main Agent's route comes from a deployment-fixed provider plus a settings-selected model, and a delegation that wants a different model has to state one explicitly through `list_subagent_models`. Nothing in the runtime knows that one route is good at mechanical edits and another at hard reasoning, and nothing notices when a better or cheaper route appears.

The cost of that is two-sided. Work that a cheap fast model would do correctly is routed to an expensive one whenever the role's pinned model is expensive, and a newly published model that is both stronger and cheaper on OpenRouter changes nothing until a human edits YAML.

The pieces needed to fix this are mostly present. [`ctx.llm.listModels(provider)`](../../../../packages/llm/llm/src/index.ts) enumerates an adapter's catalog and [`resolveModelInfo`](../../../../packages/llm/llm/src/index.ts) resolves exact per-model metadata including context capacity, output cap, reasoning efforts, and input modalities. [`openrouter-spend`](../../../../packages/llm/openrouter-spend/README.md) already reads OpenRouter's public model catalog and its per-token prices through a bounded, de-duplicating TTL cache. The [`agent/request`](../../../../packages/core/agent/src/runtime-types.ts) waterfall returns the `LlmCallConfig` for a step after assembly but before the system prompt and accepted users commit, so a listener can replace the route for that step.

Two gaps block the feature. First, nothing ranks candidates: the resolved model metadata carries no price and the catalog carries no quality signal. Second, `openrouter-spend` is deliberately Remote-only and declares no same-process Cordis `Context` merge, so a router running in the same process as the loop cannot read its catalog.

## Proposal

Add a **model routing policy** capability and let two surfaces consume it: a delegation-time resolver and an `agent/request` listener for a running Agent.

### Task classes

A task class is a closed, deployment-declarable label naming the kind of work a request is. The initial set is `mechanical`, `standard`, `hard-reasoning`, `long-context`, `vision`, and `bulk`. A class is not a difficulty guess and not a model name; it is a statement of what the work needs, which is exactly what the caller knows and the router cannot infer.

A class carries a **requirement set** and a **preference order**:

- Requirements are hard filters over resolved model metadata: a minimum context capacity, whether reasoning must be supported, and required input modalities. A model failing a requirement is not a candidate.
- The preference order is an operator-declared ranking over model identity, expressed as ordered patterns rather than an exhaustive list, so a new model matching a preferred family is eligible without a config edit.

Selection is then: filter the live catalog by the class requirements, take the highest-preference tier with any survivor, and choose the cheapest eligible model within it. Cheapest is the default objective and the deployment may override it per class.

### Why preference order and not a quality score

There is no honest quality oracle available. OpenRouter's catalog reports identity, context, modality, and price; it does not report benchmark scores, and this harness must not invent a capability number and present it as measured. An operator-declared preference order is a statement of fact — "these families are the ones we trust for this class" — and price is a value the catalog actually publishes. Ranking on those two is defensible; ranking on a synthetic score would not be.

This is also what makes the feature adapt without going wrong. Because the filter and the price comparison run against the live catalog on every resolution, a newly published model that matches a preferred family and satisfies the class requirements becomes the pick as soon as it is cheaper. A model from a family nobody has expressed a preference for is *reported* as a new candidate rather than silently adopted, so adopting a new family stays an operator decision.

### Where pricing and the catalog come from

Introduce a same-process **model catalog** seam that owns the live candidate set and its prices, with a provider that reads OpenRouter's public endpoint through a bounded TTL cache, following the read behavior [`openrouter-spend`](../../../../packages/llm/openrouter-spend/README.md) already implements.

`openrouter-spend` keeps its Remote-only contract and is not changed into a merged service. Instead the two share the underlying read: the pricing and catalog parsing move to a library both consume, so the spend report and the router cannot drift into disagreeing about what a model costs. Extracting the read is the concrete prerequisite for this feature.

### Resolving a route

The policy service exposes one resolve operation: given a task class, a provider scope, and a cancellation signal, it returns a concrete `ModelSelection` plus the evidence for the choice — the class, the policy revision, the candidate count, the winner, and what it cost relative to the rejected candidates.

**Provider scope is a parameter, not a free choice.** The accepted requirement [`preset-model-routes#c-selection`](../../../../.specs/llm/preset-model-routes.spec.md) fixes each Agent target's provider route at composition and refuses graphical writes that change it, because the provider owns the credential. Routing therefore selects *within* the deployment-authorized provider scope by default. Crossing providers is opt-in per deployment, and a class whose requirements no model in scope satisfies fails loudly rather than silently reaching for another credential.

### Consuming the policy

**Delegation.** The spawned-subagent tool gains an optional `task_class` alongside the existing explicit `provider`/`model`/`reasoning_effort` fields. An explicit route still wins, so nothing existing changes behavior; a delegated call naming only a class has its route resolved at child start. A preset row that declares `task_class` instead of `agentOptions.model` stops pinning a model.

**A running Agent.** A listener on [`agent/request`](../../../../packages/core/agent/src/runtime-types.ts) replaces the resolved route with the class-selected one, reusing the shape [`installModelSelection`](../../../../packages/core/agent/src/model-selection.ts) already establishes: capture the selection during prompt assembly, apply it at request time, and append the existing durable model-change notice when the route moves. The main Agent's class is stated per turn by the deployment or by the operator's own message handling; it is not inferred from prompt text, because inference would be a second model call whose result the loop cannot audit as cheaply as it can read a declared class.

### Durability

The route a request used is already durable: it is recorded in `request/header`. What is not durable is *why* it was chosen. A new ordinary session event, `model/routing-decision`, records the class, the policy revision, the candidate count, the winner, and the runner-up cost, so a later reader can reconstruct the decision without re-running the ranking against a catalog that has since changed.

This is an ordinary event type, so it does not bump [`SESSION_FORMAT_VERSION`](../../../../packages/core/session/src/types.ts): a reader that does not know the type gets an ignorable informational record, and the route it explains is independently present in the request header.

### Caching

Resolution is on the request path, so it must be cheap and must not add a network read per step. The catalog read keeps its TTL cache; the ranking itself is memoized against a catalog revision plus the policy revision, so a step pays a map lookup unless the catalog or the policy changed. A catalog read failure fails the resolution or falls back to the deployment default, per a configured policy that is explicit rather than implicit — silently routing to a stale default would hide a broken credential.

## What has shipped

The pure policy and its seam are implemented in [`packages/llm/model-routing`](../../../../packages/llm/model-routing/README.md). `rank.ts` holds every decision rule as a pure function: hard-requirement filtering, ordered tier preference, cheapest selection with a deterministic tie-break on ascending model id, and call pricing from the class's stated token basis. `spec.ts` validates a deployment's declarations. `catalog.ts` declares the `ctx.modelCatalog` seam, and `index.ts` exposes `ctx.modelRouting`, whose `resolve` memoizes a ranking against the catalog revision it was computed from.

Three implementation facts are worth carrying forward.

**A missing schema field is not an absent one.** Schemastery materialises a default empty array for a declared-but-unset array field, so a class that never mentions input modalities arrives with `inputModalities: []` rather than `undefined`. The ranker therefore treats an empty modality list as requiring nothing. A naive `!== undefined` check demanded modalities from every candidate and rejected the entire catalog. Anyone adding a requirement here must test the unset case, not only the set one.

**Config-facing types use mutable arrays.** A schema-typed interface whose fields are `readonly string[]` does not satisfy `z<T>` under `exactOptionalPropertyTypes`, so the declared class types are mutable while the candidate type they are matched against stays readonly. The vocabulary lives in `types.ts`, which the repository's coverage configuration excludes as a types-only file — which is why the id constructor lives in `spec.ts`, where it is measured.

**The seam is defined; nothing fills or consumes it yet.** No provider maps a real catalog into candidates, delegation accepts no `task_class`, no listener replaces a running route, and a decision is not recorded durably. Each is remaining work, and each is why this note stays a proposal.

The read the provider will need is now shared. [`dsh-openrouter-catalog`](../../../../packages/llm/openrouter-catalog/README.md) owns the `GET /models` parse, the raw-price conversion, the bounded TTL cache, and the failure-mapped endpoint helper, and [`dsh-openrouter-spend`](../../../../packages/llm/openrouter-spend/README.md) now depends on it for the pricing half of its estimate. Neither consumer depends on the other, so the spend report stays off the routing path while the two still cannot disagree about a price. The authenticated `/key` half, the session attribution, and the USD math stay with the spend report.

## Alternatives considered

**Infer the class from prompt text with a classifier model.** Rejected as the default. It adds a model call and its latency to every step, and it puts a model-visible decision behind an unaudited heuristic. A declared class is cheaper, deterministic, and reviewable. A classifier remains a possible *producer* of a class for surfaces that cannot declare one, and could be added later behind the same policy service.

**Rank on benchmark scores.** Rejected for now. No benchmark source is available in the runtime, and hardcoding a capability number would present an opinion as a measurement. Revisit if a real per-model evaluation feed is added, at which point it becomes another input to the ranking rather than a replacement for the preference order.

**Promote `openrouter-spend` into a merged same-process service.** Rejected. Its Remote-only shape is a deliberate decision that keeps the session-cost projection off the loop's dependency path. Merging it would put a spend-reporting service on the request path and force every loop composition to mount it. Extracting the shared read keeps both contracts intact.

**Replace the per-role pinned models outright.** Rejected as the first step. The existing pinned routes are the reference deployment's tested behavior and the accepted preset requirements describe them. Making `task_class` additive and letting an explicit route win means the router can be enabled per role and rolled back per role.

**Auto-adopt any newly published model.** Rejected. Silently switching a role onto an unknown family is exactly the failure this feature would be blamed for. New candidates outside the declared preference order are surfaced for an operator decision.

## Acceptance criteria

- A delegated task naming only a task class runs on a route selected from the live catalog, and the class, policy revision, candidates, and winner are durable in the session log.
- Selecting a class whose requirements no in-scope model satisfies fails with a diagnostic naming the class, the scope, and the failing requirement; it does not fall back to another provider.
- With the catalog unchanged, adding a cheaper model that matches a preferred family and satisfies the class requirements changes the next resolution's winner with no configuration edit.
- A model outside the declared preference order does not become the winner; it is reported as an observed new candidate.
- A catalog read failure behaves per the configured policy, and the failure is visible rather than silently degrading to a default route.
- An explicit delegation route still overrides the class, and every existing pinned role keeps its current route with routing disabled.
- Ranking adds no network read on a request path whose catalog and policy revisions are unchanged.

## Risks

**Selection on the request path can add latency or surprise.** The memoization and the TTL cache are what keep it off the network; a missed cache key turns every step into a catalog read. Cache-key completeness needs its own test.

**A preference order is an operator-maintained artifact and can go stale.** The mitigation is that staleness is visible — an outdated order shows up as observed-but-rejected new candidates — rather than silent.

**Cheapest-within-tier can pick a model that is nominally capable and practically worse.** Context and modality filters are coarse; two models satisfying the same class requirements are not equally good. The preference order is the only real control, and classes should be narrow enough that a tier means something.

**Route churn invalidates the prompt cache.** A route change mid-session already appends a durable model-change notice and starts a new request series. A router that switches often would pay that cost repeatedly, so per-class resolution should be stable across consecutive steps of one turn.
