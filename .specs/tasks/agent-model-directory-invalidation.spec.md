---
id: TASK:llm/agent-model-directory-invalidation
type: task
status: accepted
summary: Keep an open Agents settings page synchronized with live custom role contributions.
owners: [carlo]
progress: done
addresses:
  - REQ:llm/openrouter-agent-models#c-directory
  - REQ:llm/openrouter-agent-models#c-ui
labels: [agents, settings, lifecycle, ui]
assignee: carlo
---

# Agent model directory invalidation

## Acceptance

A visible named-role registration or final removal publishes one post-commit
directory notification while equivalent reference-count changes publish none.
The Host forwards that notification, and an already-open Agents page refetches
the directory so custom preset roles such as Guru appear without a retry or
page reopen.
