---
id: REQ:tools/deferred-discovery
type: requirement
status: accepted
level: MUST
summary: Optional tool discovery admits relevant specialist definitions without widening agent permissions.
owners: [carlo]
---

# Deferred tool discovery

:::{requirement id="deferred-discovery" level="MUST"}
- {#c-opt-in} Discovery MUST be optional, provider-neutral, and owned by the tool registry's presentation mechanism; existing configurations MUST retain eager presentation.
- {#c-search} A bounded search tool MUST rank the currently authorized deferred tools using a maintained lexical-search implementation and admit matching definitions for subsequent model requests.
- {#c-authority} Discovery MUST never reveal or execute a restricted tool, cross agent scopes, bypass execution policy, or revive an unregistered tool. Undiscovered deferred tools MUST reject direct and programmatic execution.
- {#c-durability} Successful discovery results MUST durably identify admissions. Resume and fork MUST reconstruct admissions from recorded facts; cancelled or rejected discovery MUST not publish admission. Request headers MUST retain the exact schemas sent to the model.
- {#c-presentation} Native schemas and generated TypeScript and Python tool SDKs MUST agree on admitted tools. Each search request and result MUST obey configured bounds; ranking and presentation order MUST be deterministic.
- {#c-evidence} Focused tests and an assembled keyless recorded-session scenario MUST cover discovery, execution, restrictions, disposal, resume, and reduced initial schema exposure.
:::
