# @deepseek-ai/dsh-client-ui-settings-models

English | [中文](README.zh.md)

Graphical OpenRouter configuration for the Models and Agents settings pages, plus the first-run OpenRouter credential step. The client plugin joins the provider directory, redacted Settings descriptors, credential state, and the generated `agentModels` Remote namespace; it never receives secret values.

## Models page

The Models page edits routes owned by `llm-pi-ai`. A provider row shows credential state with a text-and-wash badge, never a color-only indicator. The primary field is a write-only API key input; a typed key is stored through `credentials.set`, while `settings.yaml` retains only its reference. Provider-native authentication remains available when a profile names no key reference.

The OpenRouter first-run card and onboarding dialog address the exact `llm-pi-ai.providers.openrouter` profile. They stop appearing once a usable route exists. The add card can declare another pi-ai route, including an OpenAI-compatible gateway the installed catalog does not know.

Curated fields include endpoint, route display name and protocol where the catalog cannot supply them, plus the model list and capacities. **Fetch available models** interrogates the endpoint currently in the draft and opens a picker; it does not write anything. Every settings edit is a path mutation against the redacted section and carries the revision the card read, so a concurrent writer causes a conflict instead of losing changes.

## Agents page

The Agents page renders one card for the main Agent and every named role currently registered through `ctx.agentModels`. All cards use the provider fixed by deployment composition. Each card offers the exact models and reasoning levels advertised by that provider; Apply validates the pair on the Host before storing it under `agent-models.agents.<id>`, and Restore default removes that role's user override.

Changes apply only when a new Agent starts. Existing Agents and sessions retain their logged selection. A deployment without writable Settings shows the same directory with disabled controls.

## Onboarding

The shared onboarding coordinator first shows the versioned internal-testing notice, then the OpenRouter credential dialog when no usable provider route exists. The dialog reuses the Models editor in credential-only mode. Continue records the notice version; Configure later skips only the current coordinator pass.

## Model Experience

None. These pages configure later requests but add no model-visible content.

#### KV Cache effect

None directly. A changed Agent selection takes effect on a future Agent start and therefore begins that Agent's own provider prefix.

## Known Limitations and Deferred Work

- The Agents page deliberately cannot change the deployment-fixed provider route.
- Model discovery covers OpenAI-compatible listing endpoints; other routes are entered from their installed catalog or by hand.
- A live route without a configurable-provider address remains available to request routing but has no Models-page editor.
