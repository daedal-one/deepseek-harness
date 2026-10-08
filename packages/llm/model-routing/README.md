---
description: "Task-class model routing policy: the ctx.modelRouting service that resolves a declared kind of work into a concrete route by ranking live catalog candidates against hard requirements, operator preference tiers, and price."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-routing

## Summary

Declare a task class's capability requirements, ordered model preferences, and representative token counts. Resolve it against a catalog snapshot to select the cheapest eligible model in the highest available preference tier. Ranking is a pure function of those inputs, so the same class and snapshot produce the same route. Selection stays within the requested provider route and never selects another credential.

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

Mount `ctx.modelRouting` with a table of declared classes and mount any `ctx.modelCatalog` provider that serves the provider routes those classes resolve against.

```yaml
- name: '@deepseek-ai/dsh-model-routing'
  config:
    classes:
      mechanical:
        requirements: {}
        costBasis: { inputTokens: 10000, outputTokens: 1000 }
        tiers:
          - name: fast
            modelPatterns: ['deepseek/*flash*', 'z-ai/*flash*']
          - name: any
            modelPatterns: ['*']
      hard-reasoning:
        requirements: { requiresReasoning: true, minContextTokens: 128000 }
        costBasis: { inputTokens: 40000, outputTokens: 8000 }
        tiers:
          - name: frontier
            modelPatterns: ['moonshotai/kimi-k3*', 'deepseek/deepseek-v4*']
```

`resolve(id, provider, signal?)` returns a `RoutingResult`. On success it carries the winning candidate, the tier that matched, the estimated USD cost of one representative call, the nearest beaten candidate, and the evidence behind the choice. On failure it carries why, naming the class and the cause.

### What a class means

- **Requirements are filters, not preferences.** A candidate failing one is removed rather than ranked lower. A requirement the candidate cannot evidence fails: a model that publishes no context capacity cannot satisfy a context minimum, because a hard requirement must be provable rather than assumed.
- **Tiers are ordered best-first.** A model matching an earlier tier beats a model matching a later one whatever either costs.
- **Patterns name families.** `*` matches any run of characters and every other character is literal, so `deepseek/*` admits a released-today model of that family without a configuration edit.
- **Price is compared by pricing a stated call.** The class declares the prompt and completion tokens of one representative call, and candidates are ranked by what that call costs. The basis is a stated modelling assumption rather than an unexplained blend.
- **A model outside every tier is reported, never selected.** Adopting a family the operator has not expressed a preference for stays an operator decision.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The package splits a policy that must be reviewable from a catalog that changes underneath it. `rank.ts` is pure and holds every decision rule; `spec.ts` validates a deployment's declarations; `catalog.ts` declares the seam a provider implements; the service joins them and memoizes.

### Why an operator preference rather than a quality score

No honest quality oracle is available in the runtime: a provider catalog reports identity, context, modality, and price, and does not report benchmark results. Ranking on an operator's stated preference plus a published price is defensible; ranking on a synthetic capability number would present an opinion as a measurement.

### Failure is informative

`unsatisfied` outcomes carry the same evidence a selected outcome does: every eligible model id, every model outside the tiers, and every rejection with the requirement it failed. A class nobody can satisfy is diagnosed from its own result rather than by re-running the ranking by hand.

### Caching

The service reads a catalog snapshot on every resolve and memoizes the ranking against that snapshot's revision, keyed by provider and class. An unchanged revision returns the identical result object, so a repeated step of one turn pays no re-ranking. Keeping the catalog off the network is the provider's own TTL cache, not this package's.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Public vocabulary: classes, tiers, candidates, results, and their evidence |
| [`src/spec.ts`](src/spec.ts) | `taskClassId`, the composition schema, and the checks a schema cannot state |
| [`src/rank.ts`](src/rank.ts) | Pure ranking: requirement filtering, tier preference, cheapest selection, call pricing |
| [`src/catalog.ts`](src/catalog.ts) | The `ctx.modelCatalog` Service Definition and its snapshot contract |
| [`src/index.ts`](src/index.ts) | `ModelRouting`: the `ctx.modelRouting` service and its memoized `resolve` |
| — | No invariant companion is published; every decision is a pure function of validated configuration and one snapshot, and the service holds only a memo. |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-openrouter-spend`](../openrouter-spend/README.md) owns the OpenRouter catalog and pricing read the routing provider shares.
- [`dsh-agent-default-model`](../../core/agent-default-model/README.md) owns the persistent per-Agent model selection this policy complements rather than replaces.
- [Task-class model routing decision](../../../.agents/notes/proposed/architecture/2026-10-06-task-class-model-routing.md) records why routing ranks on preference and price, and why `openrouter-spend` was not promoted into a loop-path service.

<a id="model-experience"></a>
## Model Experience

None, as the routing policy registers no prompt section, tool schema, or message content; a consumer owns what the model sees.

#### KV Cache effect

None from ranking itself. A consumer that applies a resolved route to a running Agent starts a new request series and invalidates the cached prefix; this package only supplies the route.

## Known Limitations and Deferred Work

- No provider ships in this package. `ctx.modelCatalog` is a Service Definition only, so a deployment must mount a provider that maps a provider's catalog into `RoutingCandidate`; the OpenRouter provider is not implemented yet.
- No consumer is wired yet. Delegation does not accept a `task_class` argument, and no listener replaces a running Agent's route from a resolved class, so the policy is reachable from a composition and from tests but not from a model turn.
- A resolution is not recorded durably. The class, policy revision, candidates, and winner are returned to the caller but not yet written as a session event, so a historical decision cannot be read back from a log.
- One requirement set applies per class. There is no way to vary requirements by turn, by participant, or by an escalation within one class.

### Dev Note

None.
