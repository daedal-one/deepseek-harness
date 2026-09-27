# Agent Note: Bounded live summaries for dense agent activity

Status: implemented

## Problem

Long-running coding turns can append reasoning-only Assistant steps, Tool calls, Tool results, retries, and delegations faster than a user can scan them. The durable trace remains necessary for debugging, search, and Trajectory, but rendering every process record in compact Chat makes the current state hard to find. Generating status inside the primary agent request would add latency and cost to the turn being observed, while a client-only summary would be neither durable nor reconstructable.

## Decision

The Web composition mounts `@deepseek-ai/dsh-session-activity-summary-llm` beside Session and LLM services. It groups completed Tool results, settled nested PTC dispatches, and reasoning-bearing Assistant messages into configurable batches of four through six operations; the shipped value is five. Turn closure may flush a final four-operation tail. Summary work runs asynchronously and never delays the main agent loop.

Each dispatch records `activity-summary/request` with the exact bounded messages, system prompt, route, operation seqs, and token cap before calling the auxiliary model. An accepted one-to-three-line response records `activity-summary/update` with its revision and covered seq. This follows the [reconstructable request decision](../architecture/2026-07-05-reconstructable-requests.md) without injecting auxiliary events into main-agent history.

The summary request treats operation records as untrusted data. Tool arguments and results are byte bounded. A reasoning-bearing Assistant message contributes a content-free completion marker and may contribute its visible text, but never its reasoning text. Every dispatch selects the provider-neutral `off` reasoning effort, and the DeepSeek adapter also disables thinking for the `activity-summary` request purpose. The shipped route is OpenRouter `deepseek/deepseek-v4.1-flash`; deployments choose another explicit route only when it remains within their cost policy.

One Session owns at most one in-flight summary request. Later operations queue for the next revision. Session and plugin disposal abort and join owned work. A timeout, cancellation, malformed response, excessive output, tool request, stale completion, or other first failure publishes no update and disables further summaries for that Turn, leaving the detailed rows visible.

Chat adds request-consuming and latest-wins update Definitions under the [business-node assembly decision](../architecture/2026-08-09-client-conversation-node-assembly.md). Compact presentation hides only successfully covered Tool, Retry, and reasoning-only Assistant rows. Visible Assistant commentary remains present. The underlying Nodes and durable events are not deleted, and Trajectory continues to expose the complete trace.

## Alternatives considered

**Summarize in the browser with fixed heuristics.** Rejected because Tool payloads and provider failures need semantic condensation, and a client-only result would differ after reload and provide no durable evidence for what the user saw.

**Ask the primary coding model to narrate every batch.** Rejected because it couples monitoring to the turn's context, latency, and failure path. The provider-routed LLM contract supports an independent explicit route, so the monitor can use a cheaper model without changing the agent route.

**Hide process rows immediately and fill the summary later.** Rejected because a failed auxiliary request would erase the only visible account of work. Rows become replaceable only after an accepted durable update cites their seqs.

**Send hidden reasoning to improve the summary.** Rejected because Tool facts and content-free reasoning completion markers are sufficient to describe progress. Hidden reasoning is neither required nor appropriate input for a user-facing monitor.

## Consequences

Compact Chat presents a small moving status instead of a growing wall of non-text actions, while ordinary agent commentary and the complete durable trace remain available. The monitor adds one independently billed request per shipped five-operation batch and a final request only for a four-operation tail. The byte, token, line, route, cadence, and timeout policy is explicit deployment configuration.

The two new Session event types become released durable vocabulary and require the normal adjacent-format and consumer discipline. The auxiliary request can finish after newer operations have queued, so revisions update one stable Chat row rather than adding historical status rows. Parent Sessions summarize delegation calls, not private child-session logs; cross-Session aggregation remains outside this feature.
