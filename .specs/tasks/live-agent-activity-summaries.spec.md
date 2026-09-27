---
id: TASK:ui/live-agent-activity-summaries
type: task
status: accepted
summary: Add cheap live model summaries for dense agent activity in Web Chat.
owners: [carlo]
progress: completed
addresses:
  - REQ:ui/live-agent-activity-summaries#c-cadence
  - REQ:ui/live-agent-activity-summaries#c-route
  - REQ:ui/live-agent-activity-summaries#c-input
  - REQ:ui/live-agent-activity-summaries#c-log
  - REQ:ui/live-agent-activity-summaries#c-presentation
  - REQ:ui/live-agent-activity-summaries#c-failure
  - REQ:ui/live-agent-activity-summaries#c-lifecycle
  - REQ:ui/live-agent-activity-summaries#c-evidence
labels: [session, llm, web, ui]
assignee: carlo
---

# Live agent activity summaries

## Plan

Add a Web-only Session plugin that folds completed operations into bounded five-operation batches, records the exact auxiliary request, streams an explicit cheap route with reasoning disabled, validates a short plain-text result, and appends a latest-wins durable summary event. Extend the existing Turn-process Chat presentation so an accepted summary replaces dense process rows in compact mode without deleting their underlying nodes or changing Trajectory.

## Acceptance

Package tests prove the scheduler, one-request concurrency, operation framing and bounds, hidden-reasoning exclusion, accepted-output limits, stale/failure behavior, and joined teardown. Client tests prove replay and live replacement, latest-wins updates, and raw-trace fallback before any accepted summary. A Loader-backed Web composition test proves the shipped OpenRouter DeepSeek V4.1 Flash route and five-operation, three-line policy. Focused snapshots cover the user-visible summary event, and type, lint, specification, documentation, and build gates pass.

## Qualification

The focused runtime, provider, profile, and Chat suite passes 214 tests, including an inline snapshot of the latest accepted user-visible summary. Repository typecheck, client and Web builds, all 32 documentation gates, specification lint, and focused outgoing-diff lint pass. The repository-wide lint command continues to report unrelated failures already present in the merged sandbox and OpenRouter expense-monitoring files.

## Sources

- [Session event log](spec:src:packages/core/session/src/index.ts)
- [LLM service](spec:src:packages/llm/llm/src/index.ts)
- [Turn process projection](spec:src:packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts)
- [Web bundle](spec:src:packages/bundle/web-app/cordis.patch.yml)
