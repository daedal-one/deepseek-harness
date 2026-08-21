# Agent Note: Preset-specific Agent model providers

Status: implemented

## Problem

The Agent model settings service fixes one provider for every main and named Agent target in a process. That rule keeps graphical settings from changing credential routes, but it also prevents two standing presets from using different providers. Named roles compound the conflict: two presets can expose the same `coder` tool while requiring independent provider defaults, yet the tool name is also their settings identity.

Provider choice belongs to deployment composition because it selects a credential and transport. Agent preset documents remain portable descriptions of model-facing capabilities and role defaults; they do not own host credentials or user settings.

## Decision

`dsh-agent-default-model` fixes the provider per target instead of per process. Its fallback `{ provider, model, reasoningEffort? }` remains the main route for deployments and presets without an assignment. The optional `presets` table maps a preset id to an independent main-Agent target with its own provider, model, reasoning effort, and display label. `mainSelection(presetId)` resolves that target, and a saved session switch writes only its model and effort under the same target.

The settings document remains provider-free. Every target stores only `model` and optional `reasoningEffort`; validation resolves those values against the provider fixed on that target. The graphical directory identifies the provider on each row and carries one catalog per distinct visible provider, so the Agents page can render mixed-provider targets without offering a provider selector.

`dsh-tool-subagent` accepts `agentModelId` independently of `toolName`. Presets that expose the same model-facing role use preset-qualified settings ids while retaining canonical tool names for prompts and delegation. Omission preserves the tool-derived id used by existing compositions.

Host and headless entry points resolve composition before choosing an unlogged main-Agent default. The Host derives the effective preset from the immutable header plus any blank-session selection event on every live default read. A logged request selection remains authoritative, so resumption and established conversation prefixes do not drift when deployment settings change.

The Daedal host reference activates pi-ai's installed `openai-codex` route and assigns `daedal-openai` an independent main target. The self-contained Daedal OpenAI preset uses GPT-5.6 Terra for general implementation and research, GPT-5.6 Sol for difficult reasoning and verification, and GPT-5.6 Luna for bounded browser, crawler, translation, and extraction work. The existing `daedal` preset and the host-owned tool-policy classifiers retain their OpenRouter routes.

## Alternatives considered

**Let the Agents page select a provider.** Rejected because a provider change selects a different credential and network route. That is deployment authority, not a per-role preference; graphical role settings remain limited to the assigned catalog.

**Put provider routes in `preset.yml` or `agent.cordis.yml`.** Rejected because preset documents are agent-plane composition while credentials, adapters, and persistent settings are host-plane services. A portable preset must not silently activate a credential route.

**Use one Harness process per provider.** Rejected because the preset roster already supports independent session composition in one Host. Separate processes duplicate persistence, browser hosting, authorization services, and session discovery solely to preserve a global-provider restriction.

**Use the tool name as the settings identity in both presets.** Rejected because equivalent names would either conflict at registration or force two different provider defaults into one stored selection. A distinct opaque id preserves the model-facing role name without coupling settings ownership to it.

## Consequences

One Host can run the existing OpenRouter Daedal preset and the OpenAI Codex counterpart concurrently. Settings > Agents shows both provider catalogs and persists independent overrides without a settings migration. Existing configurations remain valid because the fallback route and tool-derived role ids are unchanged when the new fields are absent.

A deployment that renames a preset must update its `agent-default-model.presets` key and any preset-qualified named-role ids if it wants to retain existing overrides. Unknown preset ids intentionally use the fallback route; the roster remains authoritative for whether a preset can compose.
