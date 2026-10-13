# Agent Note: Explicit tool-policy approval

Status: implemented

## Problem

Repeated identical calls add no authorization evidence. Teaching an agent to repeat a denial until a counter opens approval wastes model turns and rewards the loop that the guard should help it leave. An uncertain policy result still needs one autonomous recovery opportunity before interrupting the user.

## Decision

The enforcer returns the policy reason and directs the agent to `request_tool_approval` with the denied call id and justification. Repetition never opens approval. The tool verifies a completed automatic policy denial in the same Session and open turn, then uses the existing approval service. Deterministic denials cannot be approved.

Approval does not execute the action. A successful approval-tool result and its `allowed-once` audit pair authorize the first subsequent call with the same tool and canonical arguments in that turn. Recorded call order consumes the grant before asynchronous policy evaluation, including failed or cancelled retries. Current deterministic policy still applies. Grants derive from the durable log, so restart cannot reset or duplicate authority. Object-key order is immaterial; array order and values remain exact. Native and PTC calls use their own recorded start and result events.

A request already answered or pending for a denied call cannot prompt again. User rejection is final for that action in the current turn, including when a fresh denial gives it another call id. New user input in another turn can establish a new request. Cancellation and unavailable answerers grant nothing. Approval settings remain owned by the approval service.

The [archived explicit-approval decision](../../archived/feature/2026-08-24-deferred-tool-policy-approval.md) records the superseded threshold mechanism. The [independent evidence decision](../bug-fix/2026-08-18-independent-tool-policy-evidence.md) continues to own classification.

## Alternatives considered

**Keep retry escalation as a fallback.** Repetition would still be a supported way to interrupt the user and the model could continue selecting it. An explicit tool makes the escalation intent observable without duplicate policy attempts.

**Ask the user on the first uncertain verdict.** This removes the agent's opportunity to adapt to the reason and makes classifier false positives immediate interruptions.

**Use sandbox escalation or an ordinary question.** Sandbox escalation only widens sandbox access; a question result is not an approval-service grant. Neither supplies exact policy authorization in a full-access policy-reviewed Session.

**Keep process-local grants.** Reload and restart would change authority independently of the recorded audit. Derivation from completed events preserves one authority and requires no retention tunable.

## Consequences

One explicit approval exchange replaces repeated denied attempts. The agent must retry after success because the tool requests permission without becoming another execution transport. Approval ends with the current turn and is consumed by the first matching attempt even when execution fails; another execution requires a new denial and approval. Focused tests cover exact matching, repeated calls, concurrent calls and requests, rejection, unavailable or disabled approval, turn expiry, restart reconstruction, and deterministic denial. Recorded-session replay and the assembled Daedal profile exercise the visible denial, approval, and execution path.
