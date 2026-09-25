---
id: TASK:llm/openrouter-expense-monitoring
type: task
status: accepted
summary: Add OpenRouter key-spend and per-session cost readings to the Web client as a session conversation view.
owners: [carlo]
progress: done
addresses:
  - REQ:llm/openrouter-expense-monitoring#c-key-usage
  - REQ:llm/openrouter-expense-monitoring#c-session-cost
  - REQ:llm/openrouter-expense-monitoring#c-secret
  - REQ:llm/openrouter-expense-monitoring#c-failure
  - REQ:llm/openrouter-expense-monitoring#c-cache
  - REQ:llm/openrouter-expense-monitoring#c-ui
  - REQ:llm/openrouter-expense-monitoring#c-evidence
labels: [llm, openrouter, ui, web]
assignee: carlo
---

# OpenRouter expense monitoring

## Acceptance

The shipped Web profile exposes the readings through two new packages: the host package `@deepseek-ai/dsh-openrouter-spend` at `packages/llm/openrouter-spend` publishes one Typert Remote method, `openrouterSpend.read({ sessionId })`, and the client package `@deepseek-ai/dsh-client-ui-openrouter-spend` at `packages/client/ui-openrouter-spend` contributes a `conversation.view` entry with id `spend`, label "Spend", and `order: 20`, so it appears alongside the existing `chat` (order 0) and `trajectory` (order 10) tabs in every session.

The reading calls `GET /api/v1/key` against the configured OpenRouter base URL with the existing inference credential `OPENROUTER_API_KEY` to obtain the key's spend and limit, and prices the session's durable token usage against the routed model's price from the public `GET /api/v1/models` price table. It requires no management key and never calls the account-credits endpoint `GET /api/v1/credits`.

The credential stays on the host: it is used only to build the `GET /api/v1/key` request and never reaches the client, a session-log record, or a diagnostic, log line, or error detail.

An unconfigured, unauthorized, rate-limited, unreachable, or malformed read surfaces a distinct stated failure state, and the reading never renders a fabricated zero. When the routed model's price is missing, the session cost is reported as explicitly unpriceable, `null` rather than a zero, because OpenRouter returns `-1` as a pass-through price marker.

Repeated reads are served from a bounded cache with a deployment-configurable lifetime, and concurrent reads de-duplicate into a single upstream request.

Keyless host package tests cover parsing, pricing, caching, and the credential-missing path, and client tests cover the loading, success, unpriceable, and failure states.
