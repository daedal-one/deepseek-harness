---
id: TASK:tools/deferred-tools-command-rules
type: task
status: accepted
summary: Add optional deferred tool discovery and validated deterministic command-prefix rules.
owners: [carlo]
progress: done
addresses:
  - REQ:tools/deferred-discovery
  - REQ:guard/command-prefix-rules
labels: [tools, policy, mcp]
assignee: carlo
---

# Deferred tools and command rules

## Acceptance

Implement provider-neutral discovery of deferred tool definitions with scoped authorization, durable admission, resume and fork reconstruction, and consistent native and programmatic presentation. Add token-prefix command rules with load-time positive and negative examples, strictest-match decisions, and existing hard-denial and independent-review behavior. Deliver optional configuration, package documentation, focused regression tests, and keyless recorded-session evidence through a shipped profile.
