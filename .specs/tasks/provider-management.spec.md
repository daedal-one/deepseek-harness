---
id: TASK:llm/provider-management
type: task
status: accepted
summary: Restore graphical provider management and add the native pi-ai OpenAI Codex account route.
owners: [carlo]
progress: done
addresses:
  - REQ:llm/provider-management#c-directory
  - REQ:llm/provider-management#c-layering
  - REQ:llm/provider-management#c-crud
  - REQ:llm/provider-management#c-openai
  - REQ:llm/provider-management#c-oauth-store
  - REQ:llm/provider-management#c-oauth-lifecycle
  - REQ:llm/provider-management#c-oauth-ui
  - REQ:llm/provider-management#c-runtime
  - REQ:llm/provider-management#c-evidence
labels: [llm, providers, openrouter, openai, oauth, configuration, ui]
assignee: carlo
---

# Conversation provider management

## Acceptance

The live Web profile shows OpenRouter and working provider add, edit, and remove actions even when user settings replace its catalog. Installed OpenAI and OpenAI Codex routes are discoverable; Codex device authorization persists and refreshes its credential through the shared credential service, supports cancellation and logout, and drives pi-ai's native Codex Responses route. Focused service, concurrency, host API, client, composition, snapshot, and browser tests prove the assembled behavior without committing credentials.
