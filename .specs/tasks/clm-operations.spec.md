---
id: TASK:tools/clm-operations
type: task
status: accepted
summary: Implement the first sequential operation runner and CLM adapter for the Dike evaluation.
owners: [carlo]
progress: done
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

Execution eligibility remains limited to explicitly composed, independently reviewed read-only definitions. No production tool is eligible by default, and shipped profiles do not mount the operation service by default.

## Acceptance

All referenced obligations have focused evidence through the real tool pipeline. Invalid plans and mandatory failures prevent effects, complete-action choices preserve source values, cancellation and recording failures prevent later dispatch, and Session replay reproduces exact decision inputs without tools or inference. The provider validates identity, token bounds, candidate distributions, and configured acceptance rules. Both SDK projections and a supported-profile keyless snapshot include the new durable records.

Record live-provider smoke status explicitly. An unavailable or unexercised model service is an outstanding provider-validation item, not a successful inference test. Paid Dike runs require a separately bounded experiment decision with deployment, duration, cost estimate, and spending ceiling.

## Deterministic implementation and evidence

Admission rejects schema-proven impossible references before any nested policy, tool, inference, or operation record, while unknown schemas retain concrete runtime guards. Actual selected records remain available to the corresponding step assertions and completion checks. Real-registry tests cover exact-definition eligibility, at-most-once body dispatch, ordinary policy denial, append/flush failures, and cancellation/deadline drains. Effective body-signal interruption remains distinct from caller cancellation and the operation deadline even when a finalizer replaces the tool error or a wrapper returns success.

Admission, arguments, canonical results, and judgment evidence carry caller correlation and source-bound configuration/schema/value fingerprints. The CLM provider pins its configuration and implemented serialization; credential references distinguish routes without recording credential values. Replay checks recorded relationships without tools or inference and retains unknown outcomes for interrupted started work. The original operation rows from checkpoint `139b3697d0b25b5bd447ad689ad29ec05bded7c6` remain byte-for-byte preserved in `packages/experimental/operation/tests/fixtures/legacy-v1-operation-records.json`, with checksum and legacy replay tests.

The authored keyless scenario is `snapshots/sdk/clm-operations/`. Both SDKs retain complete raw records, and Python independently checks their canonical hashes and correlation links. This is plumbing evidence, not a model-selected plan or a CLM quality result. As approved for this completion pass, the owning scenario may refresh its current-writer golden output; no runtime Session migration, stored-history overwrite, or history rewrite is authorized. Preserve original records independently rather than inventing a Session-format version change.

The final focused regression set has 394 passing tests, including real ordinary timeout-policy composition and original-record compatibility. Host typecheck, scoped lint/build, supported-profile SDK refresh/replay, and focused Python SDK projection have passed. All 32 documentation gates passed. Publication is recorded separately in the final report.

## Qualification and tooling limits

Live CLM smoke, deployed tokenizer/ceiling equivalence, deployment/calibration validity, and Dike task-quality evaluation remain unexercised and require separately approved resources. The local `spec` CLI and Rust toolchain are unavailable; automated intent rendering, `spec lint`, and Forge Intellect adherence evidence are not claimed. These limitations do not authorize paid inference or toolchain provisioning. Finish relevant pre-push verification, then commit and push the existing branch without rewriting shared history.

## Deferred scope

Dedicated Operations mode, sole-call batch enforcement, a custom timeline, general DAGs, dynamic command generation, automatic retries, compensation, automatic resume, production mutations, and fine-tuning are excluded. Later mode and mutation milestones require separate accepted tasks after the experiment's decision gate. Commits touching these specifications carry the appropriate `Spec-Ref:` trailer; Forge Intellect owns attributable implementation evidence.
