---
id: TASK:web/openrouter-search
type: task
status: accepted
summary: Replace the shipped DeepSeek search path with OpenRouter-routed web search.
owners: [carlo]
progress: done
addresses:
  - REQ:web/openrouter-search#c-default
  - REQ:web/openrouter-search#c-routing
  - REQ:web/openrouter-search#c-result
  - REQ:web/openrouter-search#c-policy
  - REQ:web/openrouter-search#c-settings
  - REQ:web/openrouter-search#c-evidence
labels: [web, openrouter, search, settings]
assignee: carlo
---

# OpenRouter web search

## Acceptance

The shipped bundle, settings UI, package graph, durable event vocabulary, and
documentation contain no DeepSeek-specific search path. An OpenRouter provider
uses the current web-search server tool with explicit model, engine, privacy,
budget, and logging behavior; focused keyless coverage and a self-skipping live
test verify normalized citations through the real Web capability.
