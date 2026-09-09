---
id: TASK:maintenance/upstream-rebase
type: task
status: accepted
summary: Rebase the Daedal fork onto upstream 0.1.5-alpha.2 while preserving its policy, memory, provider, Forge, and mobile behavior.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy
  - REQ:guard/tool-policy-permission-mode
  - REQ:integration/forge-runtime
  - IFC:integration/forge-session-adapter
  - REQ:llm/provider-management
  - REQ:llm/preset-model-routes
  - REQ:llm/openrouter-agent-models
  - REQ:web/openrouter-search
  - REQ:ui/poor-connection-resilience
  - REQ:ui/responsive-web-shell
  - REQ:ui/llm-output-rate
labels: [maintenance, migration, integration]
assignee: carlo
---

# Upstream rebase

## Acceptance

The fork descends from upstream commit b2e3b2a0125854567a4a5fcba75782e42fe84901. The pre-rebase fork remains available as a recovery reference. Equivalent upstream implementations satisfy the existing requirements without restoring obsolete APIs.

Daedal presets retain configured provider routing and per-role models, independent tool-policy evidence and enforcement, trusted subagent principals and validated results, reviewed project and global memory, English-output filtering, and Forge-managed sessions and workspaces. The Web application retains recoverable connection state, mobile usability, and honest output-rate reporting. Upstream PDF previews load version-pinned binary resources through the authenticated Connection only when requested by an open document; boot retains the fork's bounded transfer budget.

Existing fork session logs migrate without losing policy, memory, English-output, or delegation records. Migration preserves the original generations, remaps attributable event references, rejects malformed or unsupported records, and never silently discards model-visible or authorization evidence.

Maintained source and documentation remain English-only. Source checks, focused behavior and migration tests, assembled snapshots, built profile smokes, and affected browser flows validate the integrated implementation. Real-provider and performance validation report their observed results and any unavailable evidence explicitly.
