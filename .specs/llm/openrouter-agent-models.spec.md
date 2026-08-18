---
id: REQ:llm/openrouter-agent-models
type: requirement
status: accepted
level: MUST
summary: Shipped agents use OpenRouter through pi-ai and expose persistent graphical model and reasoning configuration per agent.
owners: [carlo]
refines: []
categorized_under: []
---

# OpenRouter agent models

## Context

The dedicated DeepSeek adapter duplicates provider behavior already supplied by pi-ai, while named subagent models remain embedded in preset composition files. Provider credentials and agent role assignments therefore have different configuration surfaces, and routed OpenRouter models can run without an explicit reasoning selection.

:::{requirement id="openrouter-agent-models" level="MUST"}
- {#c-provider} Shipped compositions MUST use the pi-ai OpenRouter route for conversation-model requests and MUST NOT include the dedicated DeepSeek LLM adapter package or route.
- {#c-catalog} The OpenRouter route MUST retain its installed catalog while allowing an exact dated or routed request identifier to inherit another installed model's complete metadata.
- {#c-routing} An `openai-completions` route or model MUST be able to declare OpenRouter provider-routing preferences, MUST preserve omitted routing fields as OpenRouter defaults, and MUST send the resolved preferences as the request `provider` field.
- {#c-directory} The model-settings owner MUST expose the main agent and every live named agent contribution as a lifecycle-safe directory with stable opaque ids, display labels, and deployment defaults; equivalent scoped registrations MUST coalesce, conflicting definitions MUST fail, and visible registration or removal MUST publish a post-commit directory change.
- {#c-selection} Each agent entry MUST resolve its model and optional reasoning effort from persistent user settings over its deployment default, with the provider route fixed by the deployment.
- {#c-validation} A graphical write MUST resolve the exact OpenRouter model and reasoning effort before persistence and MUST refuse an unknown agent, unavailable model, unsupported effort, read-only settings, or stale revision.
- {#c-ui} Web Settings MUST provide a dedicated graphical Agents page that lists the configured OpenRouter catalog and lets the user save or reset the model and reasoning effort independently for each agent without editing YAML; an open page MUST converge when live role contributions change.
- {#c-lifecycle} A saved change MUST affect subsequent main-agent selection reads and subsequent child starts, while a request selection already reconstructed from a session log remains unchanged.
- {#c-onboarding} First-run model onboarding MUST configure the OpenRouter credential through the shared provider editor and MUST contain no dedicated-DeepSeek editor or onboarding path.
:::
