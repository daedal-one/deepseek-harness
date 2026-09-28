# Agent Note: Terminal workspace failures and explicit recovery

Status: proposed

## Problem

The deployed [workspace supervisor](../../../../packages/sandbox/local-container-runtime/src/workspaces.ts) schedules another settlement after every failure and separately retries failed idle checkpoints. Neither path has a terminal error outcome. Repository errors are collected into an AggregateError whose generic message replaces the actionable causes in the Session record. Cancelling model execution does not cancel these background retries.

Live inspection on 2026-09-28 found the CLM conversation repeating saving/pending every five seconds, a reconciliation conversation with more than 20,000 historical failures, and a Metis conversation with more than 21,000 historical failures before a successful return. CLM files remained present while its acknowledged checkpoint lagged the implementation edits. Resource exhaustion was not evident at inspection. Metis records included quota, symlink, writer-timeout, and string-size errors; CLM's underlying error was not recoverable from its generic recorded message.

The [conversation workspace decision](../../implemented/architecture/2026-09-20-conversation-git-workspace.md) remains authoritative for isolation, ownership, transaction replay, source-ref publication, and preservation. This proposal replaces only automatic retry and ambiguous pending-state behavior. The [accepted task](../../../../.specs/tasks/workspace-terminal-failures.spec.md) owns delivery and validation. No runtime change or live recovery is claimed by this proposal.

## Proposal

Abort a save attempt on any unexpected failure. Retain its transaction and workspace, publish an actionable terminal outcome, and require an explicit authorized recovery action. Do not add a retry classifier or backoff loop: the first implementation performs one attempt per trigger, including for apparently transient errors. Successful turns still initiate automatic saving once; recovery never requires a model turn.

Use one attempt controller for turn finalization and idle checkpointing. Keep execution outcome, save outcome, acknowledged checkpoint, repository return receipts, and runtime quiescence distinct: a completed answer can coexist with a failed save, and a preserved working directory is not a durable checkpoint.

## Implementation status

The isolated draft based on deployed revision `7c1744f6a0b49b1c5b057999b0b8a3937e23961a` removes both retry timers, prevents automatic recovery on reopening and ownership changes, records terminal failures in the recovery manifest and Session, preserves nested repository causes, and provides human status/retry commands. Remote Linux qualification passes 71 focused lifecycle cases, both real Podman Loader scenarios with retries disabled, the terminal-failure SDK replay, two Client projection cases, and the workspace package composite type check. The full build and two recorded-session Chromium cases also pass; the browser cases verify the terminal failure label and diagnostic details while preserving the completed answer. Eight focused Python SDK checks passed locally. Container scenarios cover successful return, preserved source edits, restart recovery, failed writer settlement, explicit retry, retained output, and interrupted-turn checkpointing. These results do not establish real-model or deployed-session recovery.

Linux qualification exposed a synchronous Session-flush exception that abandoned an in-flight failure-manifest write during teardown. Failure persistence awaits both outcomes even when service lookup or flushing throws synchronously; the synchronized regression blocks manifest publication while the Session flush throws. The container fixtures use a workspace-root writer-release marker across repository layouts and retain an operation lease while asserting execution-world identity through explicit retry. Successful idle release may replace that container on subsequent admission.

Targeted abort and cancellation states, an attempt-wide deadline, bounded admission, safe release of failed-workspace capacity, structured/redacted error records, and deployed-session qualification remain required before completing the broader task. The command's signal currently cancels capacity acquisition, not an already running save. Failed workspaces retain execution permits. This proposal remains proposed, and the accepted task remains in progress. The remote main service is stopped; live workspaces have not been deleted, recovered, or resumed by this change.

Release validation remains incomplete. Focused lifecycle lint reports 13 findings also reproduced on the unchanged deployed revision; it is not claimed clean. The changed browser test has no lint findings. Remote quick documentation checks pass all 14 checks, and full documentation validation passes all 32 checks after supplying base-revision Git metadata, updating the browser fixture's configuration consumer, and regenerating the persistence catalog. Direct local Agent Note format, Markdown wrapping/link, and Client localization validators passed. The local native addon required Xcode's matching SDK; the Linux addon built without that workaround. No PR, commit, push, deployment, or main-service restart is included in this draft.

## State transitions

An attempt has a branded identity and a durable association with the workspace, original turn or idle-release trigger, and retained transaction. Substages describe progress inside saving; they are not independent retry schedulers.

| Current state | Trigger | Next state | Required effect |
|---|---|---|---|
| Ready or previously settled | Durable turn end or eligible idle release | Saving | Close new mutation admission and start one attempt |
| Saving | Quiescence, capture, commit, checkpoint, return, or receipt progress | Saving at next stage | Persist the acknowledged milestone before advancing |
| Saving | All required receipts durable | Returned or checkpointed | Report only the outcome actually achieved |
| Saving | Validation, timeout, controller, Git, or persistence failure | Failed | Stop scheduling and retain transaction/storage |
| Saving | Explicit abort | Cancelling | Reject new stages and cancel owned work |
| Cancelling | Owned activity proven stopped | Cancelled | Preserve storage and report last acknowledged milestone |
| Cancelling | Stop deadline or teardown failure | Failed | Report unproven quiescence and retain the ownership lease |
| Failed or cancelled | Explicit authorized retry | Saving, new attempt identity | Reconcile publication receipts and reuse pinned transaction inputs |
| Failed or cancelled | Timer, reconnect, page open, or ordinary prompt | Unchanged | Return the recorded failure and recovery action; no retry |
| Saving found after restart | Recovery inspection | Failed/interrupted | Reconcile known receipts without automatically starting another save |

Reject illegal transitions at the owning operation. Concurrent retry requests coalesce only when they name the same expected failed attempt; stale requests fail explicitly. A late callback cannot change a terminal attempt or its successor. If publication won a cancellation race, report the published receipt honestly rather than relabelling successful publication as cancelled.

Admission waiting is separate from save progress. Capacity waits must have a configured deadline and cancellation path; a failed workspace rejects queued mutation requests with the terminal failure instead of leaving them waiting. Recovery controls must not require the mutation slot whose failure they are repairing.

## Failure records and durability

Record attempt identity, trigger, failed stage, stable error code, safe repository-relative subject, bounded cause chain, last acknowledged checkpoint, successful return receipts, and permitted next actions. Preserve individual repository failures rather than replacing them with an aggregate summary. When preservation also fails, retain both the original operation error and the preservation error.

Apply redaction and byte/item bounds to the complete diagnostic, including nested AggregateError and cause chains. Do not persist raw credentials, environment values, unbounded subprocess output, or stack traces as user-facing text. Unknown failures remain explicit unknown failures; do not classify from fragile message regexes.

Persist the terminal attempt record independently of the optional recovery checkpoint. If Session persistence fails, retain the record in the owner-only workspace recovery journal and mark the live outcome as not durably acknowledged. If that journal also fails, stop in memory, log the bounded persistence failure, and retain the storage and lease. Never report a terminal record or checkpoint as durable before its write is confirmed.

Legacy pending records become recovery-required on load, without rewriting released Session generations or starting a timer. Select the repository's supported event/schema evolution mechanism during implementation; update every validator, projection, recorded fixture, and SDK consumer in the same change. A newer failed-state event must not be silently interpreted by an older consumer as successful or active saving.

## Abort, retry, and resource ownership

Add authenticated inspect, abort-save, and retry-save operations scoped to the selected conversation and expected attempt identity. Reuse the command/Remote authorization infrastructure, not an unguarded administrative endpoint. Inspection exposes retained state without allocating a new execution world. Abort remains usable during saving and admission waits. Retry starts exactly one save, not a coding-agent continuation.

Aborting cancels stage admission, owned subprocess/controller work, and metadata-model calls, then awaits bounded teardown. Stop only writers owned by that workspace using the runtime's established process ownership rules. Do not claim quiescence from a sent signal. Do not delete caches, resolve Git conflicts, reset refs, or discard uncommitted files as automatic recovery.

After quiescence is proven, failed workspaces can release active runtime capacity while retaining their durable directory and last valid checkpoint. Preserve the distinction between clean/reusable execution capacity and unsaved storage. A new allocation must never reuse or overwrite retained workspace bytes. If writers cannot be stopped, retain the lease and expose the blocking owner; do not hide that failure behind a successful release.

Retry reconciles current host refs and existing provenance before publication. Reuse persisted tree, parent, commit message, timestamp, transaction identity, and successful per-repository receipts. Never overwrite an externally moved ref or issue another naming/model request for an already recorded choice. Recovery of a disposed controller may recreate its execution runtime only against the same retained workspace identity.

## Implementation ownership

The workspace supervisor owns transitions, durable attempts, recovery operations, and both retry removals. Runtime providers own cancellation and quiescence. Git transfer and controller code own structured stage errors and idempotent publication. Session schemas and projections own durable replay; client presentation and SDKs expose the same outcomes. No agent-loop behavior change is necessary unless inspection proves an extension point is missing.

Remove retryDelayMs from the workspace configuration and all first-party consumers once timers are removed. Keep stage deadlines deployment-configurable, add a validated total attempt deadline and an admission deadline, and derive per-stage time remaining from that total. Bound cancellation separately because reaching quiescence remains necessary after the attempt deadline. A timeout must abort the underlying work and await settlement, not merely win a Promise.race while mutation continues.

The UI shows Failed, Cancelled, or Recovery required with the failed operation, concise cause, and last saved/returned milestones. Spinners represent only active attempts or bounded waits. Details distinguish files retained on disk from acknowledged recovery and returned branches. Explicit recovery controls operate without model calls. Both SDKs preserve these distinctions and structured errors.

## Alternatives considered

**Exponential backoff or a finite automatic retry count.** This reduces event volume but repeats deterministic failures and delays the actionable outcome. Explicit one-attempt recovery is simpler and matches the requested abort-on-error policy. A future transient retry policy would need typed external errors, a fixed budget, and its own acceptance evidence.

**Increase checkpoint quotas or delete generated files automatically.** This addresses only some historical failures and can erase unacknowledged work. Limits stay explicit; artifact cleanup requires a separately authorized, path-scoped operation.

**Treat model cancellation as save cancellation.** Model execution and post-turn storage work have different lifetimes. A targeted save operation must own its cancellation and report its actual settled result.

**Restart the server to clear pending state.** Restart is a maintenance action affecting unrelated conversations and can reconstruct the same failing save. Durable terminal state prevents a restart from silently authorizing another attempt.

## Acceptance criteria

- Controlled-clock tests prove no save, idle-release retry, event growth, model call, or commit occurs after failure without an explicit retry.
- Barrier-based tests cover abort versus completion, late callbacks, duplicate retry requests, disposed runtimes, and capacity release only after quiescence.
- Fault injection covers every durable publication point, nested repository errors, persistence failure, dirty retained files, partial repository success, ref conflicts, oversized checkpoints, invalid symlinks, and writer deadlines.
- Restart and reconnect tests preserve failed/cancelled state and never treat conversation selection or an ordinary prompt as retry authorization.
- Real Linux execution verifies owned process teardown and retained files; recorded Session replay, TypeScript and Python SDK expectations, and browser tests verify user-visible outcomes and recovery actions.
- Deployment verification includes the actual service revision, terminal state in affected sessions, unchanged event counts beyond the former retry interval, retained workspace content, and one explicitly selected idempotent recovery. Passing local tests alone is not deployment evidence.

## Risks

Fail-fast saving trades automatic transient recovery for visible operator action. Durable failure records and recovery controls must ship together to avoid trapping users in a state with no supported exit. Shutdown must not overwrite the failure with a generic checkpoint result or erase newer unacknowledged files. Legacy consumers and records require explicit handling. Preserve the full ownership decision as a partial supersession; no active or archived note is deleted by this proposal.
