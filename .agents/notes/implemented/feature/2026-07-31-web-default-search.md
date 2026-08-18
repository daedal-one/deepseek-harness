# Agent Note: Default Web search in shipped compositions

Status: implemented

English | [中文](2026-07-31-web-default-search.zh.md)

## Problem

The harness had a complete Web capability family—provider registry, multiple search providers, local fetch, stable model tools, and structured result presentation—but the shipped `dsh web` composition mounted none of it. The model could not discover current information unless a deployment supplied a custom overlay. Merely mounting a provider would not complete the WebUI path: the Models page stores credentials through `ctx.credentials`, while a provider that freezes only the process environment at plugin load cannot observe a key entered or rotated in the running UI.

## Decision

`apps/cli/config/base.cordis.yml` explicitly mounts `dsh-web` with `searchProvider: openrouter`, `dsh-web-search-openrouter`, and `dsh-tool-web` with `fetch: false` and `searchTimeoutMs: 60000`. It does not mount `dsh-web-fetch-http` or select a fetch provider. The shared base makes only `web_search` a default for TUI, browser, and headless sessions. The explicit search provider id keeps selection independent of registration order and leaves personal or `--config` overlays able to replace or disable the rows. The one-minute shipped budget covers an auxiliary OpenRouter Chat Completions request plus server-side retrieval while leaving `dsh-tool-web`'s provider-neutral 30-second default unchanged for custom compositions. The [OpenRouter search decision](2026-08-18-openrouter-web-search.md) owns the current provider choice.

OpenRouter search uses the same `OPENROUTER_API_KEY` credential reference as the shipped conversation route. The provider resolves that reference inside every search through the optional `ctx.credentials` service; only a composition without the seam falls back to the launching process environment, and a non-empty literal `apiKey` remains the programmatic last resort. A stored or rotated Web Models key therefore reaches the next search without restarting or retaining the value on the provider. Because `WebSearchProvider.available()` is synchronous, it treats an installed resolver as locally usable and missing dynamic credentials fail the operation with the provider-specific `WEB_PROVIDER_CREDENTIAL_MISSING` code while the stable tool schema stays registered.

Search reuses `OPENROUTER_BASE_URL` while remaining a distinct Chat Completions request from the conversation turn. Each `web_search` carries OpenRouter's server tool with automatic native-or-hosted engine selection. Immediately before dispatch, the provider appends a log-only `web/openrouter-search-llm-request` event to the initiating Agent session with the resolved endpoint and exact secret-free JSON body. Credential preflight remains provider-local and races caller cancellation; neither concern expands the generic Web or credentials seams.

The default mount does not create a Web-specific permission policy. `web_search` executes outside the shell/filesystem sandbox and approval presets, following `dsh-tool-web`'s existing contract. It does not mount `web_fetch` or a local fetch provider, so the default does not grant model-selected arbitrary URL retrieval. The shipped `workspace-write` default governs file mutations only; a restricted-network product stance requires a `tools/pre-execute` policy or capability-specific network confinement rather than implying that filesystem access mode governs Web calls.

## Alternatives considered

**Mount only `dsh-tool-web`.** Rejected because stable schemas without registered providers would make every default call fail; enablement and backend availability are deliberately separate, but a shipped default must supply its intended implementations.

**Read `$DSH_HOME/.env` from `cordis.yml` or hoist it into `process.env`.** Rejected because the credential provider owns that document, environment values are read-only overrides, and hoisting would make stored keys unrotatable while bypassing the audited secret boundary.

**Freeze `process.env.OPENROUTER_API_KEY` at provider load.** Rejected because the Web Models page writes through `ctx.credentials`; the product's documented first-run path must make the next operation work without a restart.

**Keep Web tools in `web.cordis.yml`.** Rejected because it preserves an unexplained tool-roster difference between TUI and Web/headless. The rows are not surface-specific, so `base.cordis.yml` is their one home; the [tool-roster decision](2026-07-31-even-out-shipped-tool-rosters.md) records the shared composition.

**Raise `dsh-tool-web`'s provider-neutral timeout.** Rejected because custom providers and deployments own different latency expectations; the shipped OpenRouter composition owns this deployment budget.

**Enable search and fetch together.** Rejected because default `web_fetch` would allow model-selected anonymous outbound HTTP(S) retrieval to arbitrary URLs. Search covers discovery; deployments that accept broader retrieval can opt into `dsh-web-fetch-http` and set `dsh-tool-web`'s `fetch` option to `true` in their overlay.

## Consequences

Native model requests on every shipped surface carry only the `web_search` schema and search-only prompt guidance; Web/headless Code Mode exposes the same search capability beneath `run_code`. The prompt tells the model to use returned snippets and never advertises the disabled `web_fetch` tool. Search adds a complete auxiliary model call and may use the server tool multiple times; its exact secret-free request remains reconstructable from the initiating session log. The default offers search-result snippets and source metadata but no arbitrary page retrieval; deployments that need full-page fetch must opt in. The Web snapshot lane boots the shipped tree, drives a replayed `web_search` call through the real OpenRouter provider against a local Chat Completions fixture, asserts the durable auxiliary request and structured result, and pins the settled browser presentation. The TUI/Web composition smokes pin the shared `web_search` roster and absence of `web_fetch`; the built composition dump pins the one-minute shipped search budget; provider tests pin missing, stored, and rotated credential behavior plus literal and ambient compatibility.
