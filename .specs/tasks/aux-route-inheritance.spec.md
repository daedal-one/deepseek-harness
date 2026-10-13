---
id: TASK:llm/aux-route-inheritance
type: task
status: accepted
summary: Let auxiliary Session summarizers inherit the main agent's model route instead of pinning one credential.
owners: [carlo]
progress: done
addresses: []
labels: [llm, session, defaults]
assignee: carlo
---

# Auxiliary route inheritance

## Acceptance

`session-summary-llm` and `session-activity-summary-llm` accept `provider` and `model` as an optional pair, and each request resolves its route from the Session's own main-agent selection when the pair is absent, reusing the existing `agent-default-model` service surface rather than duplicating its resolution logic. A request whose route cannot be resolved is skipped with one logged reason per Session instead of firing on a guessed route, and the skip neither records a request event nor fails the background summarizer permanently. The shipped Web composition's `session-activity-summary` and `session-summary` rows document that omitting the pair inherits the Session's main-agent route while keeping their pinned `provider` and `model` until the recorded sessions that assert that route are re-recorded with a key. The three telemetry environment variables are documented for users, including the any-non-empty-value opt-out.
