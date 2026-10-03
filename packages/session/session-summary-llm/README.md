---
description: "Durable per-Turn conversation summaries for users reading the Web Info view or the conversations sidebar, and for maintainers diagnosing the auxiliary model request behind them."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-summary-llm

## Summary

Use `dsh-session-summary-llm` to give every Session a short durable account of its topic and what has been done in it. After each Turn closes, the plugin folds that Turn's human prompts, visible Assistant text, and Tool names together with the previously accepted summary into one bounded auxiliary request without hidden reasoning. It logs the exact request and the accepted summary, and publishes the latest accepted text as the `summary` projection, so clients read one value instead of re-deriving it. Generation runs outside the Turn's critical path; one failure leaves the previous summary standing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the Session, Session-projection, and LLM services. Every field is required so a deployment chooses its route and its complete byte, token, and time policy explicitly.

```yaml
- name: '@deepseek-ai/dsh-session-summary-llm'
  config:
    targetSentences: 3
    maxEntryBytes: 2048
    maxInputBytes: 16384
    maxOutputTokens: 200
    maxSummaryBytes: 1200
    timeoutMs: 20000
    provider: openrouter
    model: deepseek/deepseek-v4.1-flash
```

`targetSentences` is stated to the model as the requested length; it is not enforced against the reply. Each collected entry's text is capped by `maxEntryBytes`, and the complete JSON frame must fit `maxInputBytes`: when it does not, the oldest entries of that Turn are dropped, and a frame that still does not fit is a failure rather than a truncated request.

Accepted output is one plain-text paragraph that must fit `maxSummaryBytes`. A Turn that contributes no entries publishes nothing. A timeout, malformed finish, tool request, empty or non-text output, excessive output, supersession, or disposal publishes no summary and records no accepted event. The exact request stays logged for reconstruction, and the previous accepted summary remains the projected value.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin registers the `summary` projection — the latest accepted text, or `null` before one lands — and listens to committed `session/event` records. A `turn/end` collects that Turn's human `user/message` text, its visible `assistant/message` text, and its `tool/call` names; a `turn/start` aborts any in-flight revision. Each Session owns at most one request at a time, and a newer Turn supersedes an older one instead of queueing behind it.

Every request is recorded as `session/summary-llm-request` before dispatch, carrying the exact route, system prompt, messages, output-token cap, reasoning effort, and source seqs. An accepted result appends `session/summary` with the summary text, the folded source seqs, the highest covered seq, and the route; that event is the projection's only input, so a replay rebuilds the same value. Hidden reasoning, Tool arguments, and Tool results never enter the request. Requests select the `off` reasoning effort, and the DeepSeek adapter also disables thinking for the `session-summary` purpose. Session and plugin disposal abort and join owned requests.

-----

<a id="model-experience"></a>
## Model Experience

### Conversation summary input

#### What the model sees

The auxiliary summary model sees the previously accepted summary plus the closing Turn's bounded records, as one JSON frame recorded by `session/summary-llm-request`: human prompt text, visible Assistant text, and Tool names only. Hidden Assistant reasoning, Tool arguments, and Tool results are never included. The main coding model sees no session-summary event, projection, or prompt.

#### Token effect

The shipped Web composition makes one auxiliary request per closed Turn, with a 16 KiB input ceiling and a 200-token output ceiling. Main-agent input and output token counts are unchanged.

#### KV Cache effect

None for the main agent. Each auxiliary request is independent and carries only the previous short summary plus the new Turn's records.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No summary before the first closed Turn** — a Session with no closed Turn has no accepted summary, and its surfaces state that absence rather than deriving one.
- **A failed revision is not retried** — one rejection leaves the previous accepted summary standing until the next Turn closes, so the projected text can lag the conversation by a Turn.
- **Session-local view** — a parent Session's summary covers its own log; a child Session's private transcript is not folded in.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published. The plugin derives each summary from one Session event stream and records its accepted result back into that same stream, so there are no independently observed relationships for an invariant to compare.
