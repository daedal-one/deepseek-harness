---
id: TASK:tasks/conversation-summary
type: task
status: accepted
summary: Generate a bounded durable conversation summary per Turn and show it in the Web Info view and the conversations sidebar hover.
owners: [carlo]
progress: doing
addresses:
  - REQ:ui/conversation-summary#c-durable
  - REQ:ui/conversation-summary#c-cadence
  - REQ:ui/conversation-summary#c-bounded
  - REQ:ui/conversation-summary#c-request
  - REQ:ui/conversation-summary#c-degrade
  - REQ:ui/conversation-summary#c-info
  - REQ:ui/conversation-summary#c-sidebar
labels: [ui, web, session, llm]
assignee: carlo
---

# Conversation summary

## Plan

Add the Host plugin `@deepseek-ai/dsh-session-summary-llm` at `packages/session/session-summary-llm`. It declares the log-only Session events `session/summary-llm-request` (exact pre-dispatch request record) and `session/summary` (accepted summary text, exact source seqs, route), and registers the client-wire Session projection key `summary` whose value is the latest accepted text or `null`.

Generation is driven by committed `session/event` records: one closed Turn (`turn/end`) starts one bounded auxiliary request from the Turn's human prompts, visible Assistant text, and tool-use names, framed as untrusted JSON. A newer Turn supersedes an in-flight request; one failure publishes nothing and leaves the previous accepted summary standing. The auxiliary call uses a dedicated `session-summary` LLM purpose.

Expose the accepted summary to the Web client by adding `summary` to the Host `sessionInfo.read` snapshot (read from the `summary` projection in the same consistent cut as the other keys) and by letting the Workspace browser read `projectionValues.summary` for its Session rows.

The client package `@deepseek-ai/dsh-client-ui-session-info` gains one leading **Summary** block rendering the summary text or the locale-owned stated absence. The client package `@deepseek-ai/dsh-client-ui-workspace` gains one summary line in the Session hover card, rendered for every non-blank Session row: the accepted summary, or the locale-owned stated absence. All copy is locale-owned.

The web-app bundle composes the plugin beside the other Session projection units with an explicit auxiliary route and complete byte, sentence, token, and time policy.

## Acceptance

Keyless Host plugin tests cover accepted generation and its logged request, projection folding of the accepted text, supersession by a newer Turn, rejection of empty, tool-call, over-budget, non-stop, and aborted output, the one-in-flight rule, previous-summary retention after a failure, configuration validation, and disposal. The Host `session-info` tests cover a present and an absent summary. Client tests cover the Info Summary block in its present and absent states and the sidebar hover line for summarized and unsummarized rows. A keyless authored SDK snapshot records the request and accepted summary events through a shipped profile. Repository generators, typecheck, lint, and the focused suites pass before the change is called done.

## Sources

- [Activity summary plugin](spec:src:packages/session/session-activity-summary-llm/src/index.ts)
- [Title projection template](spec:src:packages/session/session-title/src/index.ts)
- [Session Info service](spec:src:packages/api/session-info/src/service.ts)
- [Info view](spec:src:packages/client/ui-session-info/src/client/InfoView.tsx)
- [Workspace browser rows](spec:src:packages/client/ui-workspace/src/client/rows/Rows.tsx)
- [Web bundle composition](spec:src:packages/bundle/web-app/cordis.patch.yml)
