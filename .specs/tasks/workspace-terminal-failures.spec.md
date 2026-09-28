---
id: TASK:sandbox/workspace-terminal-failures
type: task
status: accepted
summary: Replace workspace save retry loops with durable terminal failures and explicit bounded recovery.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/conversation-git-workspace#c-finalize
  - REQ:sandbox/conversation-git-workspace#c-recovery
  - REQ:sandbox/conversation-git-workspace#c-outcomes
  - REQ:sandbox/conversation-git-workspace#c-evidence
labels: [sandbox, workspace, recovery]
assignee: carlo
---

# Terminal workspace failures

## Scope

Implement the [terminal-failure proposal](../../.agents/notes/proposed/bug-fix/2026-09-28-terminal-workspace-failures.md) against the deployed workspace supervisor, including turn settlement, idle release, restart recovery, admission, commands, client presentation, and both SDK projections. The fail-stop and explicit-retry draft has local, remote Linux container, and recorded-session browser evidence; the proposal's implementation-status section lists the outstanding cancellation, admission, resource-release, diagnostic, and deployed-session qualification work. Deployment remains pending.

Before behavior changes, amend the owning requirement's finalization and outcome clauses to replace automatic pending-save retries with terminal failure and explicit recovery. Preserve transaction replay, source-checkout isolation, and retention guarantees. Update the existing decision's partially superseded retry paragraphs and link the new decision without removing its independent ownership and durability rationale.

## Delivery

1. Add an attempt-scoped state controller with bounded stages, cancellation, durable terminal outcomes, and explicit transition validation. Remove both timer-based retry paths and their configuration consumers.
2. Preserve bounded, redacted nested failures with operation and repository identity; retain the primary failure when checkpointing also fails.
3. Add authenticated, conversation-scoped inspect, abort, and retry controls independent of model execution and ordinary mutation admission. Opening a conversation, reconnecting, or restarting must not authorize retry.
4. Preserve unsaved storage while quiescing owned writers. Release scarce runtime capacity only after proving quiescence; uncertain teardown remains explicitly failed and retains its lease.
5. Project failed and cancelled saves without a spinner; expose recovery actions and checkpoint/return distinctions through the UI and SDKs. Preserve released Session generations and handle old pending events explicitly.
6. Qualify the failure, cancellation, crash, and successful-return paths before deployment. Recover the affected server workspaces individually after immutable preservation and explicit operator selection.

## Acceptance

One deterministic failure produces one failed attempt and no timer, hidden follow-up, duplicate commit, or repeated metadata-model request. Advancing the clock, reconnecting, opening a cold session, and restarting do not cause another attempt. An explicit retry reuses the retained transaction inputs and successful repository receipts. Failure of idle checkpointing satisfies the same rules. Cancellation waits for owned activity to stop and never erases files or reports unproven quiescence. Failed admission ends rather than waiting indefinitely. Every failed attempt names its failed stage, safe cause, retained generation, and available recovery action.

Coverage includes controlled timers and barriers, nested errors, persistence failure, multi-repository partial success, invalid Git state, quota and symlink failures, writer deadlines, abort/publication races, crash recovery, unavailable controllers, capacity release, real Linux execution, recorded Session replay, both SDKs, and real browser recovery controls. Report source tests, built tests, live recovery, and deployment separately.
