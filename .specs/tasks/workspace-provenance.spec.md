---
id: TASK:sandbox/workspace-provenance
type: task
status: accepted
summary: Name returned branches from conversation context and retain searchable commit-to-conversation provenance.
owners: [carlo]
progress: done
addresses:
  - REQ:sandbox/conversation-git-workspace#c-message
  - REQ:sandbox/conversation-git-workspace#c-names
  - REQ:sandbox/conversation-git-workspace#c-provenance
  - REQ:sandbox/conversation-git-workspace#c-return
  - REQ:sandbox/conversation-git-workspace#c-outcomes
labels: [sandbox, workspace, git]
assignee: carlo
---

# Workspace names and provenance

## Implementation

Generate a bounded descriptive topic once per repository work branch from recorded human conversation context and the frozen change summary through the optional auxiliary route. Persist deterministic fallback names before dispatch and chosen names before publishing refs; retries and later title changes reuse those names. Code owns ref validation and collision-resistant identity. Naming failure never prevents saving work.

Record immutable, versioned receipts with a stable UUID, repository identity, source and returned refs, exact commit ids, workspace, conversation, turn and event range. Distinguish Harness-created commits from commits observed in returned history; imported ancestors never imply conversation authorship. Add conversation and receipt trailers to newly created automatic commits without rewriting agent-created commits. Retain receipts outside disposable workspaces and provide host-wide lookup by conversation, branch, commit, topic or receipt id, plus portable metadata export. Lookup remains available after branch deletion and process restart; it does not recover deleted transcripts.

Persist receipts before acknowledging return; recovery retries reuse transaction identities and tolerate already-published refs and receipts. Group equal returned tips in client presentation while preserving every ref in durable records. Preserve released Session generations and exercise both SDK projections. Forge integration, remote metadata synchronization and automatic transcript retention are outside this task.

## Acceptance

Focused tests establish names, invalid and unavailable model fallback, idempotent restart, externally moved refs, granular commits, multi-repository lookup, bounded/cancellable queries and metadata export. Keyless recorded-session replay and both SDK expected outputs cover provenance events. Client checks verify duplicate grouping without losing aliases.

Validation covers 100 focused tests, recorded Session replay, three Python SDK cases, and browser interaction. The optional one-request Flash quality check uses `DSH_WORKSPACE_NAMES_E2E=1`, requires `OPENROUTER_API_KEY`, and disables retries. A real Flash request with explicit reasoning controls returned valid descriptive names within the 256-token output limit. Physical Linux container and host-crash testing are outside this change's local evidence.
