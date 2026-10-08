---
id: TASK:tasks/deterministic-harness-deployment
type: task
status: accepted
summary: Make live-harness deployment deterministic and explain effective tool-policy review to agents.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/host-maintenance#c-handoff
  - REQ:sandbox/host-maintenance#c-deployment
  - REQ:sandbox/host-maintenance#c-evidence
  - REQ:guard/tool-policy-permission-mode#c-activation
  - REQ:guard/tool-policy-permission-mode#c-evidence
labels: [deployment, permissions, skills]
assignee: carlo
---

# Deterministic live-harness deployment

## Scope and impact

The deployment workflow uses the existing Daedal host handoff and an operator-owned deployment definition. It does not confer host authority, introduce a self-update command, change approval outcomes, or infer the deployed Host maintenance permission preset from its label. The tool-policy enforcer explains its actual activation and deferred approval behavior through logged runtime context and distinguishes policy-review deferrals from sandbox escalation. This task supplies a skill and policy guidance, not the participant-authority and in-session action machinery owned by [harness self-maintenance](harness-self-maintenance.spec.md).

## Acceptance

- A repository skill routes isolated execution through destination discovery and explicit host confirmation, transfers committed candidate identity and checks, and requires the destination to reload the same skill.
- Host execution requires an explicit deployment definition naming service ownership, candidate preparation and qualification, independent activation, authenticated verification, and Session-compatible recovery. Missing inputs stop deployment; paths, commands, credentials, and service names are not guessed.
- The workflow preserves the working release and companion capabilities, never restarts its own supervising process directly, reports uncertain activation without automatic replay, and records exact candidate and service readiness evidence.
- Model-visible policy context follows the enforcer's actual durable activation predicate, reports its configured approval threshold, and distinguishes exact-call policy retries from one-call file sandbox escalation. Providers continue to own tool coverage; guidance does not claim every tool is reviewed.
- Focused tests and a keyless recorded-session scenario cover effective activation, bypass, disposal, deferred feedback, and logged model context. Documentation records any unavailable host verification separately from source checks.

## Verification and remaining host work

`pnpm exec vitest run packages/guard/tool-policy-enforcer/tests` passes 15 tests. Package `tsc -b`, focused lint, and `DSH_OXLINT_THREADS=1 pnpm run lint:contracts-ready` pass. Host TypeScript compilation and tsdown bundling complete within `pnpm run doc-sync`; that aggregate finishes with 25 passing checks and seven failures outside this task: existing README examples/metadata/word limits, model-routing type-link coverage, and stale config/persistence catalogs. The owned README Model Experience check passes. Module-graph generation/freshness and `git diff --check` pass.

Built-profile replay via `DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'replays (deferred-tools-command-rules|tool-policy-deferred-context) through|gives every composition|stores session-owned inputs'` passes four tests, including two real profile replays and two ownership checks. The deployment skill body, active review context, deferred attempts, and approval rejection under `never` are persisted in the recorded scenario. Source-profile startup reaches the existing 30-second timeout with empty output, including an unchanged baseline; built-profile replay succeeds. This source-launch gap remains separate from the passing built evidence.

`spec lint` is unavailable because the specification CLI is not installed; impact and accepted intent are inspected directly, not reported as Forge-rendered or lint-validated. Live deployment configuration, host-only policy configuration, authenticated readiness, and recovery remain destination-session work. No live activation is authorized or verified; the requested host handoff is inspection-only, not activation.
