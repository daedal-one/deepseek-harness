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

## Deferred scope

Dedicated Operations mode, sole-call batch enforcement, a custom timeline, general DAGs, dynamic command generation, automatic retries, compensation, automatic resume, production mutations, and fine-tuning are excluded. Later mode and mutation milestones require separate accepted tasks after the experiment's decision gate. Commits touching these specifications carry the appropriate `Spec-Ref:` trailer; Forge Intellect owns attributable implementation evidence.
