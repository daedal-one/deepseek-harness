---
id: TASK:llm/openrouter-agent-models
type: task
status: accepted
summary: Remove the dedicated DeepSeek adapter and add persistent graphical OpenRouter model configuration per agent.
owners: [carlo]
progress: done
addresses:
  - REQ:llm/openrouter-agent-models#c-provider
  - REQ:llm/openrouter-agent-models#c-catalog
  - REQ:llm/openrouter-agent-models#c-routing
  - REQ:llm/openrouter-agent-models#c-directory
  - REQ:llm/openrouter-agent-models#c-selection
  - REQ:llm/openrouter-agent-models#c-validation
  - REQ:llm/openrouter-agent-models#c-ui
  - REQ:llm/openrouter-agent-models#c-lifecycle
  - REQ:llm/openrouter-agent-models#c-onboarding
labels: [llm, openrouter, agents, configuration, ui]
assignee: carlo
---

# OpenRouter agent models

## Acceptance

The dedicated DeepSeek LLM package and shipped route are absent; pi-ai owns an active OpenRouter route, the optional launch-environment endpoint override, additive routed-model aliases, and route- or model-level provider-routing preferences. A settings-backed agent directory applies exact validated OpenRouter selections to the main agent and named subagent starts, with `qwen/qwen3.8-27b` as Daedal's coder default. A dedicated bilingual Web Settings page edits every live agent entry, and first-run onboarding uses the OpenRouter credential flow. Focused service, subagent, client, composition, snapshot, and browser tests prove the assembled path.
