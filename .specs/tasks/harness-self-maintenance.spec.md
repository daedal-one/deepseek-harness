---
id: TASK:sandbox/harness-self-maintenance
type: task
status: accepted
summary: Split harness maintenance into authorized in-session work and a verified, reviewable host handoff for activation.
owners: [carlo]
progress: pending
addresses:
  - REQ:sandbox/harness-self-maintenance#c-insession
  - REQ:sandbox/harness-self-maintenance#c-introspection
  - REQ:sandbox/harness-self-maintenance#c-install-authority
  - REQ:sandbox/harness-self-maintenance#c-health
  - REQ:sandbox/harness-self-maintenance#c-preparation
  - REQ:sandbox/harness-self-maintenance#c-activation
  - REQ:sandbox/harness-self-maintenance#c-review
  - REQ:sandbox/harness-self-maintenance#c-rollback
  - REQ:sandbox/harness-self-maintenance#c-evidence
blocked_by:
  - TASK:session/multi-participant-sessions
labels: [sandbox, daedal, maintenance, deployment]
assignee: carlo
---

# Harness self-maintenance

## Scope

Make in-session maintenance an authorized, auditable action set: run the repository gates, inspect the composed configuration, install or update a plugin through the existing plugin management path, and reload a patch on a live profile. Every action passes the acting participant's authority check and is recorded in that Session's log.

Two surfaces need a guard rather than a new mechanism. Live runtime introspection lives in `packages/extensions` and is mounted by no shipped bundle, so the task adds the tool row to the manager's profile and refuses introspection when it is absent, instead of assuming it. The plugin management path is a pnpm forwarder with no confirmation, registry allowlist, or signature verification, so the task routes it through one explicit authorization decision and records it, rather than exposing it as routine unattended work.

Because there is no `dsh doctor`, diagnostics report, or health status API — the invariant registry throws but reports nothing — a maintenance report states the evidence it gathered from gates, the configuration dump, and the plugin inventory, and does not claim a health verdict.

Make host update preparation separable from activation. Preparation resolves the target revision, applies and verifies the candidate change in-session, records the verification evidence, and computes the exact remaining host steps and the rollback position. Activation happens only in a host-backed session reached through the existing human-confirmed handoff defined by [Daedal host handoff](../../.specs/tasks/daedal-host-handoff.spec.md).

Enrich the handoff payload so the human confirms an already-verified change: target revision, verification performed, remaining host steps, and rollback position. The harness must not attempt to update or restart its own hosting process, and must not present the update as performable by an in-session command, because no upgrade command and no runtime release check exist. Host-side activation machinery is out of scope for this task and stays with the host supervisor.

Do not change the source session's execution environment, grant a host shell, or weaken the human confirmation step. Do not add a second launcher or bypass the `dsh` profile rule.

## Acceptance

Each in-session maintenance action is refused for a participant lacking the capability and, when permitted, is durably recorded in that Session. Introspection is refused with an actionable error when its tools are not mounted. The plugin management path is reached only through a recorded authorization decision, never as a routine unattended action. A maintenance report cites the gate, configuration, and inventory evidence it gathered and claims no health verdict.

Preparation produces the target revision and verification evidence without touching the host, and an activation attempt from a non-host-backed session is refused with an actionable error. No code path offers an in-session harness update or restart.

The confirmation a human sees presents the revision, the checks already run, the remaining host steps, and the rollback position, and a declined confirmation leaves the running service untouched. A failed candidate leaves the previous working release reachable and accounts for persisted Session compatibility.

## Verification

Focused tests cover authority-checked and durably recorded in-session actions, refusal of introspection when its tools are not mounted, the plugin management path being reachable only through a recorded authorization, a maintenance report citing gathered evidence rather than a health verdict, host-free preparation producing revision and evidence, refusal of activation outside a host-backed session, the confirmation payload's four required fields, and rollback preserving the previous release. The existing handoff receiver tests continue to pass unchanged.

`pnpm run typecheck`, focused `pnpm run test`, `pnpm run lint`, the keyless recorded-session handoff scenario, and `pnpm run doc-sync`. Host activation itself is verified in a host session; this task's evidence stops at the verified handoff. `spec lint` is unavailable in this environment; the spec files are validated by inspection.
