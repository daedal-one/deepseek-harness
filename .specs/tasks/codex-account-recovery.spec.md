---
id: TASK:llm/codex-account-recovery
type: task
status: accepted
summary: Restore Web account authorization and recover legacy pi-ai credentials after the upstream rebase.
owners: [carlo]
progress: done
addresses:
  - REQ:llm/provider-management#c-oauth-store
  - REQ:llm/provider-management#c-oauth-lifecycle
  - REQ:llm/provider-management#c-oauth-ui
  - REQ:llm/provider-management#c-runtime
  - REQ:llm/provider-management#c-evidence
  - REQ:llm/provider-management#c-legacy-credentials
labels: [llm, oauth, configuration, ui]
assignee: carlo
---

# Codex account recovery

## Acceptance

Local Web Models settings expose account sign-in, provider notices and questions, cancellation, account state, and sign-out through the authorization service. OAuth-only providers do not ask for an API key. Legacy pi-ai credentials migrate atomically into their owner's current record, preserving an existing record and removing the obsolete reference so logout cannot restore it. Tests cover migration, cancellation, secret-free responses, and refresh through the native provider. The running application demonstrates migrated account authentication or reports a provider refusal requiring fresh sign-in.
