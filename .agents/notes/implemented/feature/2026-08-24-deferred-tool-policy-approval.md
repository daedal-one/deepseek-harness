# Agent Note: Deferred tool-policy approval

Status: implemented

## Problem

An automatic tool-policy `ask` interrupted the user on its first occurrence even when the acting agent could respond to the bounded reason by choosing a safer command or completing the task another way. A single uncertain or false-positive classifier result therefore became a human decision before autonomous recovery had one opportunity, while a model repeatedly insisting on the exact same call supplied a stronger signal that user escalation was warranted.

## Decision

`dsh-tool-policy-enforcer` converts an `ask` below its configured `approvalThreshold` into an effective denial whose tool result includes the provider reason, current attempt, threshold, and two available actions: change approach or repeat the exact call. The threshold defaults to three and rejects non-integers or values below two. At and above the threshold, the existing `ctx.approval` service remains the sole owner of the human decision and durable approval audit. Deterministic provider denials never become approvable.

One chain is consecutive within an open turn and identifies a call by tool name plus canonical JSON arguments. Canonicalization recursively sorts object keys, so serialization order does not change identity. An intervening tool call, turn boundary, unsupported or non-ask policy verdict, or successful approved execution breaks the chain. A rejected, cancelled, or unavailable approval is still a denied result in the same chain; another identical call therefore remains approval-eligible instead of silently consuming a one-shot opportunity.

The enforcer derives the chain from durable `tool/call`, effective `tool-policy/decision`, and `tool/result` events already owned by the execution path. It retains no process-local counter, so pickup and restart preserve the same threshold position. Provider decision events retain the provider reason; effective deferred decisions retain the complete bounded reason returned to the acting agent.

## Alternatives considered

**Prompt on the first ask.** This minimizes the number of model turns before a human can grant the call, but turns every classifier uncertainty into an immediate interruption and prevents the acting agent from adapting to the reason first.

**Offer one approval opportunity and permanently deny later repetitions.** A spent flag bounds prompts but makes a rejection, cancellation, or unavailable channel irreversible for the rest of the turn even when the user later expects the agent to retry. Keeping threshold-and-later calls eligible reflects the continuing exact insistence without bypassing human control.

**Keep a process-local counter.** A map or weak map is cheap, but restart and pickup reset escalation position while the durable log still contains the denials that caused it. Deriving from the existing event sequence preserves one authority and needs no pruning or retention configuration.

## Consequences

The default path gives the acting agent two bounded denial results before the third identical call can interrupt the user. Deliberate repetition costs model turns, but the repeated call itself is the escalation signal and every attempt remains auditable. Canonical comparison scans only the current consecutive tail of tool calls; unrelated history is not retained or reclassified. Focused runtime tests cover canonical identity, reset conditions, success, deterministic denial, and repeated rejection, while the keyless assembled Daedal profile records the two autonomous denials followed by the existing approval flow.
