# Agent Note: OpenRouter owns conversation models and Agent roles own selections

Status: implemented

English | [中文](2026-08-17-openrouter-agent-model-settings.zh.md)

## Problem

Conversation-model transport, provider credentials, routed model identifiers, and Agent-role defaults are separate concerns. A provider-specific adapter duplicates transport behavior already maintained by pi-ai, while model choices embedded in composition files give the graphical client no complete directory to edit. OpenRouter routing suffixes add another distinction: `:nitro` changes provider ordering, but reasoning is an independent request option and must remain explicit through configuration validation, Agent construction, durable request headers, and the OpenRouter wire payload.

## Decision

**pi-ai is the only shipped conversation-model adapter, with OpenRouter as the fixed deployment route.** The base, headless, Web, ACP, SDK, and Python runtime compositions register OpenRouter through `llm-pi-ai`; the dedicated DeepSeek LLM package and route are absent. Web search makes an independent auxiliary OpenRouter request because it implements the Web capability rather than conversation-model transport.

**Routed identifiers are additive aliases over the installed catalog.** `modelAliases` appends a request-wire id while requiring a `catalogModel` from the installed provider catalog. The alias inherits protocol, endpoint, capacities, modalities, reasoning dialect, supported effort map, compatibility fields, and cost metadata before applying explicit overrides. It cannot replace an installed id, coexist with a replacement `models` list, or name an unknown catalog entry. The shipped alias `deepseek/deepseek-v4-flash-0731:nitro` therefore keeps the catalog's OpenRouter reasoning protocol while sending the exact dated Nitro id.

**Agent model configuration is a lifecycle-owned directory.** `ctx.agentModels` fixes the provider route and registers `main` plus named contributors such as `subagent` and `subagent-fork`. Equivalent registrations coalesce by reference count; conflicting labels or defaults fail loud. A visible registration or final removal publishes a contained post-commit invalidation that remote clients use to re-read the directory. A named target with no explicit default inherits the main deployment default at registration time, so a later user override for `main` does not silently couple independently configured roles.

**Selections are complete per role and take effect on later Agent starts.** The `agent-models` settings section stores a model and optional reasoning effort for each stable role id. Main-session entry points and subagent tools read the current selection when they create an Agent. Running Agents retain their assembled selection; durable `request/header` events continue to reconstruct every model-visible request. Declarative `AgentOptions.reasoningEffort` is validated by the agent-loop schema and seeds the first request, so the selection cannot disappear between composition and dispatch.

**The Web client edits roles, not transport routes.** Settings exposes a dedicated Agents page backed by the generated `agentModels` Remote service. The page observes forwarded directory invalidations through a framework-bound snapshot source and refetches after live preset roles change. Each role card selects from the exact OpenRouter catalog, limits reasoning choices to the selected model's advertised efforts, saves through compare-and-swap settings revision, and restores the deployment default. Writes resolve the exact provider, model, and effort before persistence and refuse unknown roles, unavailable models, unsupported efforts, read-only settings, and stale revisions.

**OpenRouter onboarding stays in the provider editor.** First-run setup writes `OPENROUTER_API_KEY` through the shared credentials service and edits the `llm-pi-ai/providers/openrouter` settings path. Model transport remains on the Models page; Agent-role assignment remains on the Agents page.

## Consequences

The default conversation route is `openrouter` with model `deepseek/deepseek-v4-flash-0731:nitro` and effort `xhigh`. pi-ai serializes that effort as OpenRouter's nested `reasoning: { effort: "xhigh" }` object; the Nitro suffix only requests throughput-sorted provider routing. A keyless assembled snapshot captures both fields from the real one-shot composition, and the graphical Web snapshot covers save, reload, and restore for the main role while the role directory includes subagent contributors.

Configuration deliberately has two homes. Provider credentials, endpoints, headers, and catalog customization live under `llm-pi-ai`; per-role model and reasoning selections live under `agent-models`. No compatibility reader accepts the removed dedicated DeepSeek provider configuration because the repository is pre-release and misconfiguration must fail at load instead of appearing to work under a stale route.

## Alternatives considered

- **Keep the dedicated adapter beside pi-ai** — duplicates request serialization, retry integration, catalog metadata, credentials, and graphical editing for one provider.
- **Treat `:nitro` as a model with no inherited metadata** — sends the routed id but loses the reasoning dialect and effort vocabulary required for a correct request.
- **Store one global default model** — cannot represent independent main, spawn, and fork role choices and gives named contributors no graphical identity.
- **Mutate running Agents after a save** — splits one live session's model-visible behavior outside its normal request-header transition and makes an incidental settings write a lifecycle event.
