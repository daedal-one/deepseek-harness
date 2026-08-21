---
id: REQ:llm/preset-model-routes
type: requirement
status: accepted
level: MUST
summary: Agent presets and named roles use deployment-owned provider routes without making provider choice editable per agent.
owners: [carlo]
refines:
  - REQ:llm/openrouter-agent-models#c-directory
  - REQ:llm/openrouter-agent-models#c-selection
  - REQ:llm/openrouter-agent-models#c-ui
  - REQ:llm/openrouter-agent-models#c-lifecycle
  - REQ:llm/provider-management#c-runtime
aspects: [target-directory, fixed-provider-selection, graphical-catalogs, preset-lifecycle, codex-runtime]
categorized_under: []
implemented: c9f64e882389ca777e3aeb13db546f6bdfb371e2
---

# Preset model routes

## Context

One deployment-wide provider prevents otherwise independent presets from using different native conversation routes. Preset documents should remain portable agent composition while the host retains ownership of provider credentials, model defaults, and graphical settings.

:::{requirement id="preset-model-routes" level="MUST"}
- {#c-main} The model-settings owner MUST let a deployment assign a provider, model, and optional reasoning effort to a preset-specific main-agent route, MUST retain the deployment-wide main route as the fallback for presets without an assignment, MUST reject structurally invalid preset routes at load, and MUST reject target-id conflicts before registration commits.
- {#c-roles} A named-agent contribution MUST be able to declare an opaque model-settings id independent of its tool name so parallel presets can expose the same role through different deployment-owned providers without registration conflicts.
- {#c-selection} Each main or named agent target MUST resolve saved model and reasoning settings against its own fixed provider catalog, and graphical writes MUST NOT change that provider.
- {#c-directory} The graphical agent directory MUST identify each target's fixed provider and provide every distinct catalog required by its visible targets without duplicating equivalent provider catalogs.
- {#c-lifecycle} New and resumed sessions without a logged model selection MUST use the route assigned to their effective preset, including after a blank-session preset switch; a model selection reconstructed from the session log MUST remain authoritative.
- {#c-reference} The Daedal reference MUST include a self-contained `daedal-openai` preset whose main and named agents use native OpenAI Codex models through account authentication while the existing `daedal` preset remains routed through OpenRouter.
- {#c-evidence} Focused service, host, subagent, client, composition, and keyless assembled tests MUST prove provider isolation, preset lifecycle selection, settings persistence, and the OpenAI reference composition.
:::
