---
description: "Live bounded summaries for users and maintainers configuring the Web activity monitor or diagnosing its auxiliary model calls."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-activity-summary-llm

## Summary

Use `dsh-session-activity-summary-llm` to replace dense live process rows with a short, latest-wins account of agent progress. The plugin groups four through six completed durable operations, sends one bounded auxiliary request without hidden reasoning, and records both the exact request and accepted summary in the Session log. Generation runs outside the main turn's critical path; one failure leaves the original trace visible for the rest of that turn.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the Session and LLM services. Every field is required so a deployment chooses its route and complete cost, byte, line, token, and time policy explicitly.

```yaml
- name: '@deepseek-ai/dsh-session-activity-summary-llm'
  config:
    operationsPerSummary: 5
    maxOperationBytes: 2048
    maxInputBytes: 16384
    maxOutputTokens: 160
    maxSummaryBytes: 720
    maxLines: 3
    timeoutMs: 20000
    provider: openrouter
    model: deepseek/deepseek-v4.1-flash
```

`operationsPerSummary` accepts only four, five, or six. `maxLines` accepts one through three. A Tool result, nested PTC dispatch, or reasoning-bearing settled Assistant update is one completed operation. An Assistant operation contributes a content-free completion marker and may include its visible text, but never its reasoning text. Tool arguments and results are individually capped by `maxOperationBytes`, and the complete JSON frame must fit `maxInputBytes`.

Accepted output contains one through `maxLines` plain-text lines and must fit `maxSummaryBytes`. A timeout, malformed finish, tool request, non-text output, excessive output, or disposal publishes no update. The exact request remains logged for reconstruction, and Chat keeps the detailed process rows visible when no summary was accepted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin listens to committed `session/event` records and pairs each top-level `tool/result` with its `tool/call`. Five operations trigger the shipped request cadence; a closed turn flushes a final four-operation tail. Each Session owns at most one request, while later operations accumulate for the next batch. A first failure stops automatic summaries for that turn so a later boundary cannot hide activity that was never summarized.

Every request is recorded as `activity-summary/request` before dispatch. An accepted result appends `activity-summary/update` with the exact operation seqs, latest covered seq, route, revision, and lines. Requests explicitly select the `off` reasoning effort; the DeepSeek adapter also disables thinking for the `activity-summary` purpose. Session and plugin disposal abort and join owned requests.

-----

<a id="model-experience"></a>
## Model Experience

### Activity summary input

#### What the model sees

The auxiliary summary model sees the previous accepted lines plus bounded durable Tool call/result records and content-free markers for reasoning-bearing Assistant updates recorded by `activity-summary/request`. Visible Assistant text may accompany the marker; hidden Assistant reasoning is never included. The main coding model sees no activity-summary event or prompt.

#### Token effect

The shipped Web composition makes one auxiliary request per five completed operations, with a 16 KiB input ceiling and 160-token output ceiling. Main-agent input and output token counts are unchanged.

#### KV Cache effect

None for the main agent. Each auxiliary request is independent and carries only the previous short status plus its new operation batch.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Session-local view** — a parent Session summarizes delegation calls but does not ingest a child Session's private operation log.
- **No retry inside a failed Turn** — one failed summary keeps the detailed trace visible and disables later automatic attempts until the next Turn.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published. The plugin derives each summary from one Session event stream and records its accepted result back into that same stream, so there are no independently observed relationships for an invariant to compare.
