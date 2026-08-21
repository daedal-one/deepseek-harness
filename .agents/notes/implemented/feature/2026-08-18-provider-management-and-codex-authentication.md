# Agent Note: Provider management and Codex authentication

Status: implemented

## Problem

The configurable-provider directory must describe providers that are available to add even when no route is active. Provider settings also have to remain serviceable when a user replaces a composition-supplied model catalog. A recursively merged user `models` list beside inherited `modelAliases` or `modelOverrides` made the whole settings section invalid, which withdrew its provider directory and left active routes such as OpenRouter without a management row.

OpenAI exposes two distinct authentication products. The public OpenAI API uses an API key, while the Codex backend uses an OpenAI account, expiring OAuth access, refresh-token rotation, and an account identifier on native Responses requests. Treating Codex as an API-key-shaped route would either expose an expiring token to settings or leave refresh and logout races unresolved.

## Decision

`LlmRuntime` owns a provider-neutral authentication registry beside adapter and configurable-provider registration. An adapter registers one `LlmProviderAuthenticator` per provider and method. The runtime exposes account status, starts login as a bounded background operation, carries provider-issued device authorization metadata, supports cancellation, and drains matching login before logout or registration disposal. It retains at most 64 terminal operation snapshots and never carries account credentials.

The configurable-provider directory carries authentication method names. Account state is a separate Host query: `llm.providers` remains safe for ordinary model selection, while `llm.providerAuthState`, login, operation status, cancellation, and logout are loopback-only configuration-plane methods. The wire returns booleans, device codes, verification URLs, and diagnostics; tokens never enter a client response.

`dsh-llm-pi-ai` uses the installed pi-ai provider definitions as the provider source. OpenAI API-key access is the `openai` route. OpenAI Codex is the `openai-codex` route using pi-ai's native `openai-codex-responses` implementation and its device-code OAuth implementation. The Models page offers both routes, shows the API-key editor only where an API-key method exists, and gives Codex explicit sign-in, cancellation, status, and sign-out controls.

### Credential ownership and lifecycle

`HarnessPiCredentialStore` serializes pi-ai credential records into provider-specific internal references held by `ctx.credentials`. The settings document contains neither OAuth records nor references that a user must manage. Provider requests and pi-ai's refresh path read the same store, so a refreshed credential reaches the next request without rebuilding configuration.

`CredentialProvider.modify` is the shared atomic read-modify-write operation. A provider holds its storage transaction across the asynchronous update callback; `undefined` preserves the current value and `unset` remains the explicit deletion operation. The local provider performs the operation under its cross-process writer lock after re-reading the durable document. Concurrent token refreshes therefore serialize against each other, and logout waits for pending login before deleting the record so a late success cannot restore it.

### Layered provider profiles

A non-empty user `models` list is the complete model-catalog choice for its route. It takes precedence over `modelAliases` and `modelOverrides` from every configuration layer. The inherited fields are ignored for that resolved route rather than treated as a contradictory same-layer declaration. Without a replacement list, aliases and overrides retain their existing validation and additive semantics.

## Alternatives considered

**Implement an OpenAI or Codex HTTP client in the harness.** Rejected because pi-ai already owns the OpenAI Responses and Codex Responses transports, model catalog, device authorization, request compression, account-header construction, and refresh behavior. A second implementation would duplicate provider protocol code and drift from the installed catalog.

**Store OAuth tokens in settings or expose them through the Models client.** Rejected because settings are syncable and remotely describable, and browser clients do not need credential values. The credential service already owns secret persistence and invalidation.

**Return account state from `llm.providers`.** Rejected because provider and model discovery is intentionally available to trusted LAN clients, while stored-account state is credential reconnaissance. A separate loopback-only query preserves the ordinary catalog wire.

**Use independent credential reads and writes during refresh.** Rejected because two refreshes can derive replacements from the same stale token, and logout can race a late login completion. Atomic modification plus lifecycle draining makes the durable result deterministic.

**Reject a user model list when composition supplies aliases or overrides.** Rejected because recursive settings layering makes those fields coexist even though the user's list is a complete replacement choice. Giving the list explicit precedence preserves configuration ownership without adding a deletion syntax to generic settings.

## Consequences

OpenRouter, OpenAI, OpenAI Codex, and other manageable installed pi-ai providers remain visible before activation and can be added or removed from the Models page. OpenAI Codex requests use the stored account through the native transport, including token refresh, without putting credentials into settings or the wire.

Interactive OAuth support is intentionally limited to OpenAI Codex until another provider's pi-ai prompt types have matching product controls. The provider-neutral runtime can host those implementations without another lifecycle or wire redesign.

Provider-management coverage includes layered catalog resolution, concurrent durable modification, login cancellation and disposal, Host serialization and loopback fencing, Models controls, and a native Codex request against a local Responses endpoint that verifies the authorization and account headers.
