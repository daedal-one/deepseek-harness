# Agent Note: Visible model completion

Status: implemented

## Problem

A provider can report `stop` after reasoning and whitespace without returning an answer or tool call. Counting every content block as a successful response lets the loop close the Turn without work or a visible result. An operation-only planner then appears to wait for inference even though no operation starts.

## Decision

The [pi-ai adapter](../../../../packages/llm/llm-pi-ai/README.md) and [dedicated DeepSeek adapter](../../../../packages/llm/llm-deepseek/README.md) require nonblank text or a tool call at terminal stop. Reasoning and whitespace retain their exact streamed content and usage but terminate with `EMPTY_RESPONSE`. The loop records that stream as a failed attempt outside model history; the [configured request retry policy](../architecture/2026-06-21-bounded-llm-request-recovery.md) owns recovery. Independent terminal reasons remain authoritative.

The [operation-only profile](../../../../docs/user/operation-only.md) starts its decision service from actual tool dispatch and recorded evidence. A description of intended actions cannot supply executable arguments or tool authority.

## Alternatives considered

**Accept any content block.** Reasoning or newline-only output can close a Turn while providing no answer and performing no action.

**Extract a plan from reasoning or force a tool call.** Reasoning is not a validated tool request. Deriving executable actions from it bypasses ordinary model/tool JSON admission and cannot preserve exact caller intent.

**Require every operation-only response to call a tool.** A visible answer can legitimately need no action. Presence validation permits that answer and rejects only empty visible completion.

## Consequences

Synthetic HTTP and recorded Session fixtures establish error classification, preserved usage, failed-attempt retention and ordinary recovery without paid inference. They do not qualify a main model or a decision model. Original persisted Sessions and committed fixture generations remain unchanged.
