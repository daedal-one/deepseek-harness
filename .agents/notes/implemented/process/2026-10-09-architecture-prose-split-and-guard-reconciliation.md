# Agent Note: Architecture prose split and guard message reconciliation

Status: implemented

## Problem

The [turn flow](../../../../docs/architecture.md#turn-flow) prompt-surface paragraph carried pre-step admission, request-series declaration, commit order, the system-prompt surface-node model, the empty-prompt head reservation, and route capability in one physical line. That paragraph wall violated the one-topic-per-paragraph rule the same documentation standard enforces, and the document sat three words under its 2,400-word ceiling, so added prose was not an option.

Separately, two guard mechanisms gave the acting model opposing retry guidance. The deferred tool-policy denial invited repeating the exact call to reach the user, and the loop-hygiene reminder warned against repeating it. Each sentence was correct for its own chain — approval eligibility in one case, tool-loop hygiene in the other — but neither acknowledged the other.

## Decision

The [turn flow](../../../../docs/architecture.md#turn-flow) renders that mechanism as five paragraphs: pre-step admission and the series declaration; commit order, reconciliation, and retry behavior; the system-prompt surface-node model; the empty-prompt system-head reservation; and route capability plus series behavior. The split moves only line boundaries, so the document stays at 2,397 words under the unchanged 2,400-word ceiling, and every fact and link is preserved.

The [tool-policy enforcer](../../../../packages/guard/tool-policy-enforcer/README.md) directs uncertain denials to the explicit `request_tool_approval` tool. Repeated calls never enter approval. The repeat-tool-reminder independently warns about repeated calls, so neither guard encourages a retry loop. The [task spec](../../../../.specs/tasks/guard-message-reconciliation.spec.md) keeps the package descriptions consistent.

Approval semantics are owned by [the explicit tool-policy approval note](../feature/2026-10-13-explicit-tool-policy-approval.md), and the prompt-surface mechanism remains owned by [the system-prompt surface-node decision](../architecture/2026-09-02-system-prompt-as-surface-node.md). This note owns the presentation split and the independence of loop reminders from approval requests.

## Alternatives considered

**Keep one paragraph and raise the ceiling.** Raising the 2,400-word ceiling to buy line breaks treats a presentation defect as a budget defect; the same words fit under the existing ceiling when split at sentence boundaries.

**Name the reminder plugin in the model-facing denial text.** The denial is a policy result, and naming another guard's package inside it leaks plugin topology into model-visible text; the reconciliation clause carries the guidance without that coupling.

**Merge the two guards into one mechanism.** The reminder counts repeated calls for loop hygiene, while the approval tool requests a human permission decision. Combining them couples a heuristic nudge to authorization.

**Suppress the reminder during approval.** That makes one guard's state authoritative over another's and can hide a repeated-call loop.

## Verification

`pnpm run verify-doc-budgets` passes with [docs/architecture.md](../../../../docs/architecture.md) at 2,397 of 2,400 words. `pnpm run verify-md-wrap` reports no hard-wrapped prose paragraphs across 994 files. Focused policy tests pin the denial text and explicit approval behavior. `pnpm exec oxlint` reports 0 warnings and 0 errors on the changed source and test files. The enforcer plugin is mounted by no shipped profile, so no recorded-session snapshot changes.

## Consequences

The turn flow's central mechanism reads as separate claims without losing a fact or a link, and the document keeps only its original three words of budget headroom. A model that receives both a repeated-call reminder and a policy denial can change approach or request approval explicitly. The two guards keep independent ownership, keying, and lifetimes.
