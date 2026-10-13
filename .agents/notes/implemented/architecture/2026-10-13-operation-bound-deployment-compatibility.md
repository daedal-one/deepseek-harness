# Agent Note: Operation-bound deployment compatibility review

Status: implemented

## Problem

Path-based persistence checks identify changes that need review but cannot determine whether a previous release can read data written by a candidate. Editing the deployment definition to admit reviewed files changes policy for other operations and requires a later restoration step.

## Decision

The [deployment controller](../../../../scripts/server-deployment/README.md#review-session-compatibility) keeps compatibility paths fixed. Each changed-path operation pauses before building and publishes a digest-bound report. An operator supplies a compatibility decision and evidence through the restricted controller command. Administrator-owned receipts bind the operation, exact revisions, changed files, running command, controller, and configuration. Qualification and activation reject drift; the qualification approval includes the reviewed decision.

`rollback-compatible` attests forward reading of existing data and backward reading of candidate writes. `migration-required` prevents continuation. Neither process startup nor an unchanged Session version constitutes this assessment. The controller records attributable operator evidence without claiming to prove semantic compatibility.

The [host-maintenance decision](2026-09-21-host-maintenance-profiles.md) continues to own execution placement, authority, independent activation, and recovery without Session replacement. This decision adds the compatibility-review lifecycle without superseding those guarantees.

## Alternatives considered

**Temporarily exclude reviewed paths.** This widens a shared policy beyond one operation and leaves restoration to the operator.

**Treat unchanged format versions as compatibility proof.** Event readers, writers, and required event types can change independently of the structural version.

**Accept a reusable compatibility waiver.** Another base revision, candidate, controller, or configuration can invalidate the evidence. The receipt therefore belongs to exactly one operation.

## Consequences

Review and activation require separate explicit approvals. Evidence enters as bounded JSON on standard input, never as a root-readable caller path or executable command. Exclusive receipts prevent duplicate continuation after uncertain submission. A controller update invalidates prior qualifications. Incompatible changes need a separate migration and recovery procedure; the controller does not restore older Session archives over new data.

## Testing

The [controller fixtures](../../../../scripts/server-deployment/test_controller.py) exercise pre-build review, changed Git paths, evidence validation, duplicate submission, migration refusal, context drift, qualification binding, and rollback that retains candidate-written history. Private temporary directories isolate concurrent test processes. Operator installation, live qualification, and approved activation remain separate deployment evidence.
