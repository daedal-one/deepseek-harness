---
id: REQ:llm/provider-management
type: requirement
status: accepted
level: MUST
summary: Users can manage installed and custom conversation providers, including OpenRouter, OpenAI API keys, and OpenAI Codex account authentication.
owners: [carlo]
refines:
  - REQ:llm/openrouter-agent-models#c-onboarding
categorized_under: []
---

# Conversation provider management

## Context

The pi-ai adapter owns installed provider metadata and custom routes, but the graphical settings directory can disappear when a saved provider profile replaces a shipped catalog route. OAuth-only installed providers are withheld entirely, so an OpenAI account cannot be used through pi-ai's native Codex Responses provider.

:::{requirement id="provider-management" level="MUST"}
- {#c-directory} The provider directory MUST expose every installed pi-ai provider that the harness can authenticate, including inactive providers, with stable route ids, display names, authentication methods, active state, and settings ownership.
- {#c-layering} A user provider profile MUST compose with a shipped profile without invalidating the provider-settings namespace; an explicit `models` list MUST replace inherited catalog customization fields, and graphical writes MUST round-trip through the same resolution semantics.
- {#c-crud} Web Settings MUST show active shipped routes such as OpenRouter and MUST let a user add, edit, or remove user-owned installed and custom provider profiles without editing YAML; removing a user profile MUST reveal any shipped profile beneath it.
- {#c-openai} The installed OpenAI API-key provider and the installed OpenAI Codex account provider MUST be offered as distinct native pi-ai routes, and their model catalogs MUST come from the installed pi-ai release rather than copied harness metadata.
- {#c-oauth-store} OpenAI Codex account credentials MUST persist through the shared credential service, MUST refresh without exposing tokens to the client or logs, and MUST preserve one coherent credential under concurrent refresh or logout attempts.
- {#c-oauth-lifecycle} The host MUST provide start, status, cancellation, and logout operations for provider authentication; each in-flight operation MUST have an opaque id, a bounded terminal state, cancellation on owner disposal, and no late completion that restores a logged-out credential.
- {#c-oauth-ui} Web Settings MUST start the OpenAI device authorization flow, present its verification URL and user code, report pending, success, cancellation, and failure states, allow logout, and refresh provider/model availability after authentication changes.
- {#c-runtime} A Codex route authenticated through Web Settings MUST serve a subsequent conversation-model request through pi-ai's native Codex Responses implementation without an API key override.
- {#c-evidence} Keyless package tests MUST cover configuration layering, credential persistence, refresh serialization, and authentication lifecycle; an assembled Web snapshot MUST cover provider discovery and account controls, and a native Codex request against a local Responses endpoint MUST prove the authenticated route's model-visible behavior without storing a live credential.
:::
