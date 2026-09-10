---
id: REQ:integration/intellect-verification
type: requirement
summary: Conversational implementation verification
status: accepted
level: MUST
owners: [carlo]
---

# Conversational implementation verification

The Deadal-intellect profile provides repository verification without requiring
Forge services or hand-written adapter commands. Forge Spec remains authoritative
for intent; Forge Intellect remains authoritative for evidence and attestation.

:::{requirement id="verification" level="MUST"}
- {#c-onboarding} The profile discovers the current repository, installed native
  tools, durable specs, model configuration and retained runs, with actionable
  diagnostics for missing prerequisites.
- {#c-plan} A concrete immutable plan binds a clean revision, durable subjects,
  source selection, fixed checks and model routes. Execution requires an audited
  human approval of that exact plan. A changed plan or revision requires a new
  plan; a model cannot authorize its own commands.
- {#c-review} Fresh assessor and challenger sessions receive the native evidence
  packets, have no tools or inherited conversation, use shared Harness
  credentials, and retain their model inputs and outputs. Credentials never
  enter the native coordinator or repository check environment.
- {#c-gate} Only the native authenticated evidence check determines support,
  contradiction, incompleteness and attestation. Whole-owner and clause scope,
  revision freshness, provenance and missing evidence remain native decisions.
- {#c-lifecycle} Verification runs use bounded background jobs with cancellation
  and quiescent cleanup. Retained results can be inspected after restart and
  reassessed without replacing historical evidence.
- {#c-experience} The browser and headless profiles expose the same conversational
  workflow, check plan and evidence results. Review models are configurable in
  the existing agent-model settings. Ordinary profiles do not acquire these
  capabilities implicitly.
:::

[Coordinator](spec:src:packages/integration/forge-intellect/src/index.ts), [review sessions](spec:src:packages/integration/forge-intellect/src/reviewer.ts), [response validation](spec:src:packages/integration/forge-intellect/src/contract.ts), [conversation tools](spec:src:packages/integration/forge-intellect/src/tool.ts), [profile composition](spec:src:packages/bundle/deadal-intellect/cordis.patch.yml), and [acceptance checks](spec:src:packages/integration/forge-intellect/tests/profile.spec.ts).
