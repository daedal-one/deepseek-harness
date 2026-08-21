---
id: TASK:llm/preset-model-routes
type: task
status: accepted
summary: Add deployment-owned provider routes per agent preset and publish the Daedal OpenAI reference preset.
owners: [carlo]
progress: done
addresses:
  - REQ:llm/preset-model-routes#c-main
  - REQ:llm/preset-model-routes#c-roles
  - REQ:llm/preset-model-routes#c-selection
  - REQ:llm/preset-model-routes#c-directory
  - REQ:llm/preset-model-routes#c-lifecycle
  - REQ:llm/preset-model-routes#c-reference
  - REQ:llm/preset-model-routes#c-evidence
labels: [llm, agents, presets, openai, configuration, ui]
assignee: carlo
---

# Preset model routes

## Acceptance

The model-settings service owns provider-specific targets and preset-specific main-agent defaults while persistent user settings remain limited to model and reasoning effort. The Host selects an unlogged request default from the session's effective preset, named agents can use preset-qualified settings ids, and Web Settings resolves each card against its assigned catalog. The Daedal reference activates the native OpenAI Codex account route and installs a self-contained OpenAI-model preset beside the existing OpenRouter preset. Focused keyless tests cover service validation, Host lifecycle behavior, subagent identity, graphical settings, and the assembled reference composition.
