# Agent Note: End-to-end output rate for buffered LLM streams

Status: implemented

## Problem

The Web `tok/s` figure divided provider-reported output tokens by the local first-token-to-message span. That span measures chunk arrival, not necessarily model generation: a provider or intermediary can buffer an already-generated response and let the Harness append hundreds of chunks within a few milliseconds. One observed session therefore paired 19,523 output tokens with 637 ms of chunk-drain time even though its requests occupied 185,701 ms, producing a physically implausible five-digit rate. The original [latency/throughput decision](../feature/2026-08-04-web-latency-throughput-metrics.md) explicitly preserved this failure mode as replay variance rather than distinguishing transport drain speed from model output rate.

## Decision

Every Web `tok/s` figure is an end-to-end output rate: provider-reported output tokens divided by full request wall time from `step/start` to `assistant/message`, aggregated over exactly the steps carrying both. The settled turn footer and Trajectory timing inspector compute it from assistant-node `stepStartTime` and `completedTime`; the stats strip uses `sessionStats` fields `throughputMs` and `throughputTokens`, with the no-unit window fold mirroring those fields. First-token chunk time remains the TTFT boundary only and never supplies the output-rate denominator. Trajectory calls the separately displayed first-token-to-completion interval `Stream span`, not generation time.

The full request span includes TTFT, provider work, transport buffering, and any in-step retry delay. It is therefore not pure provider decode throughput, but it is the honest rate observable from the durable log. A positive duration and a finite non-negative output-token count are required; missing values are omitted, not guessed or capped.

The `sessionStats` projection uses `stateVersion: 2` because the persisted state fields and their semantics changed. A mismatched projection cache is discarded and rebuilt from the durable event log; no session event or storage format changes.

## Alternatives considered

**Cap implausible values.** A ceiling hides the symptom while retaining a measurement of buffer drain speed, and no provider-neutral threshold distinguishes a fast model from a buffered response.

**Keep first-token-to-message time but ignore very short spans.** A minimum duration is another arbitrary threshold and drops legitimate short completions. It also leaves longer buffered deliveries mislabeled.

**Remove `tok/s`.** Omission would be honest but gives up a useful comparative signal that the existing request and usage events can support conservatively.

**Use provider-side generation timing.** The common LLM protocol and durable session events carry no provider generation clock. Adding provider-specific follow-up requests or optional wire fields would make the same UI label incomparable across adapters and unavailable during replay.

## Consequences

Buffered responses no longer produce rates based on millisecond chunk-drain bursts. The figure is lower than pure decode throughput because it includes latency and retries, and remains nondeterministic because it uses wall time. The durable projection, window fallback, settled footer, Trajectory inspector, connection fixture, package documentation, and focused tests share one definition; the burst regression pins 100 output tokens delivered across a final 1 ms to the full 5-second request, yielding 20 tok/s rather than 100,000 tok/s.
