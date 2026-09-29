---
id: TASK:tools/clm-operations
type: task
status: accepted
summary: Implement the first sequential operation runner and CLM adapter for the Dike evaluation.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:tools/operations#c-composition
  - REQ:tools/operations#c-plan
  - REQ:tools/operations#c-policy
  - REQ:tools/operations#c-hard-stops
  - REQ:tools/operations#c-evidence
  - REQ:tools/operations#c-selection
  - REQ:tools/operations#c-provider
  - REQ:tools/operations#c-durability
  - REQ:tools/operations#c-lifecycle
  - REQ:tools/operations#c-replay
  - REQ:tools/operations#c-completion
  - REQ:tools/operations#c-verification
labels: [tools, operations, clm, experimental]
---

# Sequential operations and CLM adapter

## Scope

Implement milestones M1 and M2 of the [proposal](../../.agents/notes/proposed/feature/2026-09-27-clm-operations-mode.md): opt-in tool consumer, deterministic sequential runner, typed references, assertions, evidence and complete-action candidates, narrow judgment service, CLM HTTP provider, required recording barriers, and replay. The CLM adapter uses the pinned upstream System One wire and records configured deployment identity locally; autonomous acceptance requires explicit local deployment-manifest verification rather than a response identity claim. Retain existing tool dispatch and policy ownership. Add deterministic fixtures and the hooks required for fair Dike comparisons; do not treat those fixtures as model-quality evidence.

This work item is accepted and in progress. Before runtime edits, render affected intent for agents, inspect policy/discovery/persistence impact, and run spec lint. The initial implementation is confined to observation and selection fixtures with independently established read-only behavior.

## Acceptance

All referenced obligations have focused evidence through the real tool pipeline. Invalid plans and mandatory failures prevent effects, complete-action choices preserve source values, cancellation and recording failures prevent later dispatch, and Session replay reproduces exact decision inputs without tools or inference. The provider validates identity, token bounds, candidate distributions, and configured acceptance rules. Both SDK projections and a supported-profile keyless snapshot include the new durable records.

Record live-provider smoke status explicitly. An unavailable or unexercised model service is an outstanding provider-validation item, not a successful inference test. Paid Dike runs require a separately bounded experiment decision with deployment, duration, cost estimate, and spending ceiling.

## Remaining deterministic acceptance work

The recovered checkpoint `9e644caf6683ced0f3deb87f316b0e7852b197e6` has 20 passing focused tests, not completed acceptance. Continue within M1/M2 by closing operation admission and process hard stops, preserving cancellation and deadline outcomes behind recording barriers, validating source-bound replay transitions, matching encoder texts to the serialized System One payload and server token ceiling, and adding supported-profile keyless Session and both SDK projections. Record exact local checks and unavailable tooling; deterministic fixture success is not live-provider or calibration evidence.

The follow-up deterministic evidence includes real-registry policy denial, exact-definition eligibility, at-most-once body dispatch, cancellation and deadline barriers, source-bound replay against the supported SDK recording, pinned System One serialization/token-ceiling cases, and a Python SDK projection of the same durable operation records. The new authored keyless scenario is `snapshots/sdk/clm-operations/`; it is plumbing evidence, not a model-selected plan or a CLM quality result. Live CLM smoke, deployed tokenizer/ceiling equivalence, deployment/calibration validity, and Dike task-quality evaluation remain unexercised. The local `spec` CLI is unavailable, so automated intent rendering and `spec lint` remain unverified. Further deterministic acceptance work remains for pre-dispatch rejection of schema-detectable impossible dynamic references, complete caller/configuration/evidence fingerprints, and interrupted outcomes that retain a tool-owned error code rather than the registry's `ABORTED` code; this checkpoint does not close the task.

## Deferred scope

Dedicated Operations mode, sole-call batch enforcement, a custom timeline, general DAGs, dynamic command generation, automatic retries, compensation, automatic resume, production mutations, and fine-tuning are excluded. Later mode and mutation milestones require separate accepted tasks after the experiment's decision gate. Commits touching these specifications carry the appropriate `Spec-Ref:` trailer; Forge Intellect owns attributable implementation evidence.
