---
id: REQ:ui/live-agent-activity-summaries
type: requirement
status: accepted
level: MUST
summary: Chat replaces dense live agent-process rows with bounded model-generated activity summaries while retaining the complete trace.
owners: [carlo]
refines: []
categorized_under: []
---

# Live agent activity summaries

## Context

Long coding turns can stream reasoning, tool calls, results, and delegations faster than a user can follow them. The complete trace remains useful for inspection, but the primary Chat view needs a stable, low-cost account of recent progress rather than a growing wall of process rows.

:::{requirement id="live-agent-activity-summaries" level="MUST"}
- {#c-cadence} The Web composition MUST schedule one auxiliary activity-summary revision after a deployment-configurable batch of four, five, or six completed agent operations, with five as the shipped value, and MUST NOT delay the main agent turn while generating it.
- {#c-route} The shipped Web composition MUST route activity summaries through OpenRouter to `deepseek/deepseek-v4.1-flash` with reasoning disabled; deployments MAY replace the explicit route with a model whose input and output token prices do not exceed that route.
- {#c-input} A summary request MUST use bounded durable tool-call/result facts and content-free markers for reasoning-bearing Assistant updates, MAY include visible Assistant text from those updates, MUST treat the records as untrusted data, and MUST NOT send hidden reasoning content to the summary model.
- {#c-log} Every dispatched auxiliary request and every accepted summary MUST be reconstructable from durable Session events, with exact operation and sequence provenance.
- {#c-presentation} Compact Chat MUST show only the latest accepted summary for an active turn, limited to a deployment-configurable maximum of three lines in the shipped composition, in place of covered earlier process rows. Running operations and the latest Tool and reasoning disclosures MUST remain visible, and every covered process row MUST be recoverable through Chat disclosure. Trajectory MUST retain the complete trace.
- {#c-failure} A failed, timed-out, cancelled, stale, or malformed summary MUST NOT hide the underlying process trace or publish a fabricated update, and a newer accepted revision MUST supersede the prior visible summary.
- {#c-lifecycle} At most one summary request per Session MAY be in flight; later completed operations MUST coalesce into later batches, and Session or plugin disposal MUST cancel and join owned work.
- {#c-evidence} Keyless tests MUST cover batching, request bounds, reasoning exclusion, supersession, failure fallback, cancellation, replay presentation, and compact Chat replacement.
:::
