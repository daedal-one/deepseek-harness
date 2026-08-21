# Agent Note: Web turn and window latency/throughput metrics

Status: implemented

## Problem

The Web chat records per-step LLM timing (`stepStartTime` / `firstTokenTime` / `completedTime`) and per-step usage, and the trajectory view exposes them per step, but the chat surface answers neither "how responsive was this turn" nor "how fast is this session going": the assistant footer shows only the turn wall time, and the stats line folds only wall-time totals.

## Decision

A package-local fold, `ui-conversation`'s `chat/turn-metrics.ts`, is the single derivation from assistant nodes to latency/output-rate readings. `assistantStepReading` turns one node into a step reading: TTFT needs both `stepStartTime` and `firstTokenTime`, request time needs `stepStartTime` and `completedTime`, negative spans clamp to zero, and output tokens come from the untrusted `usage` value only when they are finite and non-negative. `deriveTurnMetrics` folds readings per turn: the lowest-numbered step owns the turn's TTFT slot, and output rate divides the summed output tokens by the summed full request spans over exactly the steps carrying both, so an unsampled step drops out instead of skewing the ratio; a turn with neither figure emits no entry. The [buffered-stream output-rate decision](../bug-fix/2026-08-17-buffered-stream-output-rate.md) owns the full-request denominator.

The assistant footer appends the readings to the existing hover-revealed time chrome after `Ran for`, as `TTFT {s}s · {tps} tok/s`, each omitted independently when unrecorded. ChatView shows a turn's readings only when that turn's `turnTimings` entry has an `endTime`: the loaded window is a contiguous log suffix, so an in-window settled turn carries every one of its steps and the first-step TTFT is genuine rather than a window artifact. `formatLatencySeconds` is unit-less so each locale template owns its second suffix (`TTFT {seconds}s` / `first token {seconds}s`).

The stats line reuses the same step reading in its no-unit window fallback: `deriveStats` accumulates TTFT sum/count and full request spans/output tokens, rendering a latency/output-rate group localized through the `conversation` locale namespace (`TTFT avg … · … tok/s` in English) beside the LLM/tool wall times. The turn-count, step-count, duration, cache, and token labels use the same namespace. The composed Web application reads these figures from the durable `sessionStats` projection described by the [full-session figures decision](../bug-fix/2026-08-12-full-session-turn-step-counts.md); token accounting stays on the token-meter projections.

## Alternatives considered

**Keep the stats line window-scoped.** The [full-session figures decision](../bug-fix/2026-08-12-full-session-turn-step-counts.md) rejects this scope because paging changed every displayed aggregate. The package-local fold remains only for assemblies that do not compose `sessionStats`.

**Per-step footer chrome.** Showing each assistant message its own TTFT would attach chrome to mid-turn narration nodes, which the footer design deliberately keeps chrome-free; the trajectory view already exposes per-step timing detail.

**Gating footer metrics on node presence instead of `turn/end` timing.** Rendering whatever steps happen to be loaded would show a plausible-looking TTFT that is actually the first *loaded* step after paging. The `endTime` gate plus the suffix-window invariant makes the displayed figure the turn's true first-step latency or nothing.

## Consequences

A settled in-window turn's footer reveals `TTFT`/`tok/s` on hover after the wall time, and the stats line shows whole-session average latency and end-to-end output rate with localized labels beside its wall times. Metrics degrade by omission: providers or steps without timing or usage samples drop individual figures rather than rendering zeros. Assemblies without `sessionStats` retain the documented window-scoped fallback.

Both readings divide by measured wall time, so neither is reproducible. The Web aria goldens therefore normalize throughput to `{{throughput}}` beside the existing `{{duration}}`, and the footer's decorative separators have flanking spaces — without them the readings concatenate into one accessible string (`Ran for 13sTTFT 0.2s12 tok/s`), which both loses the reading boundaries a screen reader needs and denies `{{duration}}` the word boundary it matches on.
