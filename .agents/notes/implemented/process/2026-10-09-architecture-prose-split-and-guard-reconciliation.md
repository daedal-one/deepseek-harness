# Agent Note: Architecture prose split and guard message reconciliation

Status: implemented

## Problem

The [turn flow](../../../../docs/architecture.md#turn-flow) prompt-surface paragraph carried pre-step admission, request-series declaration, commit order, the system-prompt surface-node model, the empty-prompt head reservation, and route capability in one physical line. That paragraph wall violated the one-topic-per-paragraph rule the same documentation standard enforces, and the document sat three words under its 2,400-word ceiling, so added prose was not an option.

Separately, two guard mechanisms gave the acting model opposing retry guidance. The deferred tool-policy denial invited repeating the exact call to reach the user, and the loop-hygiene reminder warned against repeating it. Each sentence was correct for its own chain — approval eligibility in one case, tool-loop hygiene in the other — but neither acknowledged the other.

## Decision

The [turn flow](../../../../docs/architecture.md#turn-flow) renders that mechanism as five paragraphs: pre-step admission and the series declaration; commit order, reconciliation, and retry behavior; the system-prompt surface-node model; the empty-prompt system-head reservation; and route capability plus series behavior. The split moves only line boundaries, so the document stays at 2,397 words under the unchanged 2,400-word ceiling, and every fact and link is preserved.

The deferred tool-policy denial from [dsh-tool-policy-enforcer](../../../../packages/guard/tool-policy-enforcer/README.md) states the current attempt and configured threshold, names varying the approach as the expected response and deliberately repeating the exact call as how the agent reaches the user when the retry is genuinely wanted, records that an intervening different call or turn change resets the chain, and records that a deterministic denial never becomes approvable. The enforcer README pins the same result text, and both guard READMEs state that the approval threshold counts consecutive identical `ask` verdicts for human escalation while the reminder counts consecutive repeated tool calls for loop hygiene, with neither suppressing the other. The [task spec](../../../../.specs/tasks/guard-message-reconciliation.spec.md) accepts that contract.

The deferred-approval chain semantics remain owned by [the deferred tool-policy approval note](../feature/2026-08-24-deferred-tool-policy-approval.md), and the prompt-surface mechanism remains owned by [the system-prompt surface-node decision](../architecture/2026-09-02-system-prompt-as-surface-node.md). This note owns the presentation split and the cross-mechanism clause.

## Alternatives considered

**Keep one paragraph and raise the ceiling.** Raising the 2,400-word ceiling to buy line breaks treats a presentation defect as a budget defect; the same words fit under the existing ceiling when split at sentence boundaries.

**Name the reminder plugin in the model-facing denial text.** The denial is a policy result, and naming another guard's package inside it leaks plugin topology into model-visible text; the reconciliation clause carries the guidance without that coupling.

**Merge the two guards into one mechanism.** The reminder counts every repeated attempt for loop hygiene while the threshold counts only consecutive identical `ask` verdicts for escalation, over different keying and lifetimes; merging couples a heuristic nudge to a permission decision.

**Suppress the reminder while a deferred-approval chain is open.** That makes one guard's state authoritative over another's and hides a genuine loop during the window where the model is most likely stuck.

## Verification

`pnpm run verify-doc-budgets` passes with [docs/architecture.md](../../../../docs/architecture.md) at 2,397 of 2,400 words. `pnpm run verify-md-wrap` reports no hard-wrapped prose paragraphs across 994 files. `pnpm exec vitest run packages/guard/tool-policy-enforcer/tests` passes 44 tests across 4 files, including the verbatim deferred-result pin. `pnpm exec oxlint` reports 0 warnings and 0 errors on the changed source and test files. The enforcer plugin is mounted by no shipped profile, so no recorded-session snapshot changes.

## Consequences

The turn flow's central mechanism reads as separate claims without losing a fact or a link, and the document keeps only its original three words of budget headroom. A model that receives both a repeated-call reminder and a deferred denial reads varying as the default response and deliberate repetition as the escalation path. The two guards keep independent ownership, keying, and lifetimes.
