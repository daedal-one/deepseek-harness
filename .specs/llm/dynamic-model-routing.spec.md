---
id: REQ:llm/dynamic-model-routing
type: requirement
status: accepted
level: MUST
summary: Route each request through a declared task class ranked against the live provider catalog, so the best eligible model for the work is chosen without editing composition.
owners: [carlo]
refines:
  - REQ:llm/preset-model-routes#c-selection
  - REQ:llm/openrouter-agent-models#c-catalog
categorized_under: []
---

# Dynamic model routing

## Context

Model routes are pinned at composition, and capability and price metadata live in an adapter catalog that no routing decision reads. A deployment should be able to state what a kind of work needs and let the harness pick the cheapest eligible model for it, including models published after the composition was written.

:::{requirement id="dynamic-model-routing" level="MUST"}
- {#c-classes} A task class MUST be a deployment-declared label carrying hard requirement filters and an operator-declared preference order over model identity. The requirement set MUST be evaluated against resolved model metadata, and a model failing any requirement MUST NOT be a candidate.
- {#c-ranking} Selection MUST take the highest-preference tier containing an eligible candidate and choose the cheapest eligible model within it. A class whose requirements no in-scope model satisfies MUST fail with a diagnostic naming the class, the provider scope, and the failing requirement, and MUST NOT fall back to another provider or to an unranked route.
- {#c-catalog} The live candidate set and its prices MUST be read through a same-process capability that a routing consumer can inject, and that read MUST share its catalog and pricing parse with the OpenRouter spend report so the two cannot disagree about a model's price.
- {#c-scope} Routing MUST select within the provider route the deployment authorized for the target. It MUST NOT cross providers unless the deployment explicitly authorizes that scope for the class.
- {#c-consumers} A delegation MUST be able to name a task class instead of an explicit route, and an explicit `provider`/`model`/`reasoning_effort` MUST override the class. A running Agent's route MUST be replaceable for a step through the request waterfall after assembly and before the system prompt and accepted users commit.
- {#c-durable} The chosen class, policy revision, candidate count, winner, and the cost of the nearest rejected candidate MUST be recorded in the session log as an ordinary event type, and the route actually used MUST remain recorded in the request header. A reader that does not know the decision event MUST remain able to reconstruct the request.
- {#c-adaptation} Resolution MUST re-evaluate against the live catalog, so a newly published model matching a preferred tier and satisfying the class requirements becomes eligible without a configuration edit. A model outside every declared preference tier MUST be reported as an observed candidate and MUST NOT become the winner automatically.
- {#c-caching} Resolution MUST NOT perform a network read when the catalog revision and the policy revision are unchanged. Catalog read failure MUST follow an explicitly configured policy, and MUST NOT silently resolve to a default route.
- {#c-default} With routing disabled, every existing pinned route MUST remain the route used, and no request MUST change behavior.
- {#c-evidence} Focused tests MUST prove class filtering, tier and price ranking, loud failure on an unsatisfiable class, provider-scope containment, explicit-route precedence, catalog-change adaptation, rejection of out-of-preference candidates, durable decision recording, and zero network reads on a memoized path.
:::
