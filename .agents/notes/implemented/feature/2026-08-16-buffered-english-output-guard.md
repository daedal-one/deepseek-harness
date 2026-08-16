# Agent Note: Buffered English output guard

Status: implemented

English | [中文](2026-08-16-buffered-english-output-guard.zh.md)

## Problem

Some exact model routes used by coding agents can answer explanatory prose or reasoning in Chinese even when their persona asks for English. Prompting alone does not enforce the user-visible language. Rewriting an already logged assistant message would split durable history from the text the UI displayed and the model later derived. Translation also handles untrusted model output, so it must not expose credentials, reinterpret tool arguments, or silently destroy code and identifiers.

## Decision

`@deepseek-ai/dsh-english-output-guard` is a scoped function plugin over existing extension points. It registers one English policy section and one `llm/stream` waterfall wrapper. The wrapper selects only process-marked agent-loop requests whose exact provider and model appear in required configuration; auxiliary and non-target requests delegate immediately.

The wrapper buffers only targeted streams. Error and aborted finishes replay exactly. Successful streams are assembled with `BlockAssembler`; responses without substantial unprotected Han replay their original chunks and replay state byte-for-byte. Drift triggers one auxiliary `ctx.llm` request under an explicit route, token cap, input cap, and deadline. A private request identity prevents recursive interception, and plugin disposal aborts and awaits owned translation work.

Only text and reasoning blocks are translated. Code fences, inline code, link destinations, URLs, paths, flags, and identifier-like spans become collision-free placeholders. The result must be strict JSON with the exact selected indexes and types, non-empty translations, every placeholder exactly once, and no substantial unprotected Han. Tool-call names, ids, raw JSON arguments, block order, usage, and finish reason remain unchanged. A transformed response uses one synthesized canonical chunk stream and omits provider replay state; an unchanged or preserved response retains the exact stream.

Before auxiliary dispatch, `english-output/translation-request` records the exact translator input and affected original blocks inside the initiating open step. `english-output/translation-result` records translated, blocked, or preserved settlement with bounded failure facts. These events are log-only; only the accepted chunks and assistant message enter canonical UI and model history. The invariant companion relates each request and result to an open step and, unless the turn aborts, relates translated and blocked settlements to the later canonical assistant message.

## Verification

Package tests cover Han thresholds, protected spans, exact route selection, no-drift replay with replay state, text and reasoning translation, code/path/URL preservation, structured tool-call retention, usage and finish preservation, invalid output, provider failure, timeout, and both failure modes through a real AgentLoop. The package typechecks as its own TypeScript project. The shipped composition snapshot remains owned by the bundle that mounts the guard.

## Alternatives considered

**Prompt-only enforcement.** Rejected because a prompt expresses the preference but cannot prevent model drift from reaching durable assistant history.

**Post-hoc assistant mutation or a replacement event.** Rejected because the stream wrapper can decide before canonical chunk and message events are appended. A second correction mechanism would widen session projection, persistence, replay, and every UI consumer without a current need.

**Direct provider HTTP.** Rejected because it would bypass adapter routing, credentials, cancellation normalization, telemetry, provider attribution, and test adapters. Auxiliary work uses `ctx.llm`.

**Translate tool arguments and structured blocks.** Rejected because translation may corrupt executable JSON, call identity, paths, and provider protocols. Only prose blocks enter the translator.

**Change agent-loop.** Rejected because `llm/stream` already owns pre-log stream interception, while `isAgentLoopRequest` distinguishes the exact main-call object. The loop stays unaware of this deployment policy.

## Consequences

Targeted drift trades streaming latency for a single canonical history: visible output waits for the main finish and auxiliary translation. Successful no-drift, error, aborted, non-loop, and non-target streams retain their original bytes and make no auxiliary request. Translation failure is an explicit deployment choice between preserving the original response and withholding affected prose. The durable audit reconstructs every model-visible auxiliary input without storing provider credentials or a second assistant history.
