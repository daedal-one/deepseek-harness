# Agent Note: Provider management and Codex authentication

Status: implemented

## Problem

The configurable-provider directory must describe providers that are available to add even when no route is active. Provider settings also have to remain serviceable when a user replaces a composition-supplied model catalog. A recursively merged user `models` list beside inherited `modelAliases` or `modelOverrides` made the whole settings section invalid, which withdrew its provider directory and left active routes such as OpenRouter without a management row.

OpenAI exposes two distinct authentication products. The public OpenAI API uses an API key, while the Codex backend uses an OpenAI account, expiring OAuth access, refresh-token rotation, and an account identifier on native Responses requests. Treating Codex as an API-key-shaped route would either expose an expiring token to settings or leave refresh and logout races unresolved.

## Decision

`ctx.authorization` owns provider-neutral sign-in lifecycles. Each pi-ai provider registers its installed methods under a scoped credential key. The settings controller exposes redacted account metadata and a cancellable Remote stream carrying notices, prompts, and terminal outcomes. Prompt and attempt ids are branded; answers are write-only. The Web profile mounts the authorization service beside its settings controller.

The local Models page presents browser and device-code instructions, select/text/secret prompts, cancellation, stored-account state, and sign-out. An OAuth-only provider hides the API-key field. The native pi-ai provider owns the OAuth protocol and Codex Responses transport.

### Credential ownership and lifecycle

pi-ai reads and refreshes records at `llm-pi-ai/<provider>` through `credentialStoreFrom`. The local credential provider serializes record modification under its cross-process writer lock. Sign-out cancels authorization before deleting the record, and the pi-ai login writer checks cancellation inside its credential transaction to prevent a detached late flow from restoring it.

Legacy `DSH_PI_AI_<PROVIDER>_AUTH` references migrate when the credential service becomes available and before authentication reads it. `migrateReference` converts the provider-managed reference and removes it in the same atomic write; an existing record takes precedence without conversion. Invalid legacy data remains intact with a diagnostic that excludes credential contents. Removing the reference prevents a later startup from restoring a signed-out account.

### Layered provider profiles

A non-empty user `models` list is the complete model-catalog choice for its route. It takes precedence over `modelAliases` and `modelOverrides` from every configuration layer. The inherited fields are ignored for that resolved route rather than treated as a contradictory same-layer declaration. Without a replacement list, aliases and overrides retain their existing validation and additive semantics.

## Alternatives considered

**Implement an OpenAI or Codex HTTP client in the harness.** Rejected because pi-ai already owns the OpenAI Responses and Codex Responses transports, model catalog, device authorization, request compression, account-header construction, and refresh behavior. A second implementation would duplicate provider protocol code and drift from the installed catalog.

**Store OAuth tokens in settings or expose them through the Models client.** Rejected because settings are syncable and remotely describable, and browser clients do not need credential values. The credential service already owns secret persistence and invalidation.

**Return account state from `llm.providers`.** Rejected because provider and model discovery is intentionally available to trusted LAN clients, while account state belongs to configuration. A separate configuration query keeps account state out of ordinary catalog reads.

**Use independent credential reads and writes during refresh.** Rejected because two refreshes can derive replacements from the same stale token, and logout can race a late login completion. Atomic modification plus lifecycle draining makes the durable result deterministic.

**Reject a user model list when composition supplies aliases or overrides.** Rejected because recursive settings layering makes those fields coexist even though the user's list is a complete replacement choice. Giving the list explicit precedence preserves configuration ownership without adding a deletion syntax to generic settings.

## Consequences

OpenRouter, OpenAI, OpenAI Codex, and other manageable installed pi-ai providers remain visible before activation and can be added or removed from the Models page. OpenAI Codex requests use the stored account through the native transport, including token refresh, without putting credentials into settings or the wire.

Account controls render the installed provider's authorization vocabulary. Sign-in state is process-local and a browser reload requires a fresh attempt. Credential values remain Host-owned; only authorization URLs, device codes, questions, and credential presence reach the browser.
