# Agent Note: Visible Chat operations

Status: implemented

## Problem

Completed-turn folding can conceal every Tool and reasoning row behind a process summary. Activity-summary coverage can also hide operations independently of the disclosure state, preventing expansion and concealing ongoing calls whose start precedes the summary watermark. The visible final answer then gives no direct access to the latest operation, and a settled reasoning summary can show an initial line instead of the latest activity.

## Decision

Compact Chat retains each Turn's latest Tool call tree and latest nonempty reasoning-bearing Assistant row. Final-answer reasoning stays directly expandable. Accepted live summaries fold covered earlier process-only rows through the same disclosure while preserving every running Tool, the latest operation and visible commentary. Live expansion persists across summary revisions; settlement selects a fresh answer generation. Earlier material remains mounted under the existing process disclosure, and a Turn with no remaining folded material shows no process control. Reasoning summaries show the latest nonempty line during streaming and after settlement.

The existing Turn-scoped presentation projection owns the retained keys and whether any foldable material remains. Its keyed subscriptions update affected Node seats after append, replacement or prepend without adding full-transcript scans to renderers. Tool trees preserve their nested calls and independent detail controls. The [live-summary decision](../feature/2026-09-27-live-agent-activity-summaries.md) continues to own auxiliary request bounds, durable provenance and failure behavior. [Chat](../../../../packages/client/ui-chat/README.md#turn-process-folding) owns the presentation contract.

## Alternatives considered

**Expand every completed Turn.** Long Tool sequences occupy the transcript even when a reader needs only the latest operation and answer.

**Keep only a text summary of the latest operation.** A second summary still conceals the Tool identity, result status, nested calls and existing detail controls.

## Consequences

Compact history retains more visible rows. Turn-summary counts remain totals for the complete Turn, including visible operations. Presentation does not change Session events, model context or permission policy.
