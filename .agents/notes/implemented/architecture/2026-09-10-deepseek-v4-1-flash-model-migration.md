# Agent Note: DeepSeek V4.1 Flash is the shipped Flash model

Status: implemented

## Problem

DeepSeek retired the V4-Flash API names and released DeepSeek V4.1 Flash on 2026-09-10, with native image understanding folded into the Flash tier. The first-party API serves the release as `deepseek-flash` and temporarily routes the retired names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` to it; OpenRouter serves it as `deepseek/deepseek-v4.1-flash`. The harness pinned the retired names in four independent places — the official adapter's advisory catalog, the shipped OpenRouter alias and default model, the SDK and subagent defaults, and the graphical model copy — and the vision-capable catalog entry existed only because V4.1 Flash's predecessor could not accept images.

The installed pi-ai catalog predates the release, so its OpenRouter data describes `deepseek/deepseek-v4-flash` but no V4.1 entry. A `modelAliases` entry needs a `catalogModel` from that installed catalog and refuses an unknown one, which leaves two ways to serve the released route: declare a `models` list, which replaces the whole OpenRouter catalog for that route, or alias the retired catalog entry and override its facts.

## Decision

**The official DeepSeek route advertises `deepseek-flash` and drops the separate vision entry.** `DEFAULT_MODELS` in `dsh-llm-deepseek` lists `deepseek-flash` as `DeepSeek-V4.1-Flash` with `inputModalities: ['text', 'image']` and the shared image request limits, followed by the unchanged `deepseek-v4-pro` entry. Image capability is a property of the Flash tier rather than a second model, so one advisory entry covers text and image requests on that route, and the model-selection dictionary keys the DeepSeek copy on `deepseek-official/deepseek-flash`.

**The shipped OpenRouter route aliases the retired catalog entry and overrides every model fact.** `modelAliases` declares `deepseek/deepseek-v4.1-flash` with `catalogModel: deepseek/deepseek-v4-flash` plus `name`, `contextWindow: 1048576`, `maxTokens: 384000`, `input: [ text, image ]`, and the `off`/`low`/`high`/`max` effort map. Protocol, endpoint, and compatibility still come from the installed entry; the alias states the name, capacities, modalities, and reasoning vocabulary the release actually has. This keeps the installed OpenRouter catalog intact for every other model, which a `models` list would replace wholesale.

**`agent-default-model` ships `provider: openrouter`, `model: deepseek/deepseek-v4.1-flash`, `reasoningEffort: high`.** V4.1 Flash advertises `max`, `high`, and `low`; `high` is the release's own default effort and the only one of those the previous default did not already use.

**SDK, subagent, and reviewer defaults name the released routes.** The TypeScript SDK client and the Python `DeepSeekHarnessConfig`, `minimal.py`, and SDK README default to `deepseek/deepseek-v4.1-flash` on OpenRouter; the ACP application bundle and `dsh-subagent-dsh-sdk` default to `deepseek-flash` on `deepseek-official`; `dsh-forge-intellect` keeps OpenRouter and defaults to `deepseek/deepseek-v4.1-flash`. The `sdk-minimal` bundle declares the same alias as the base bundle, since it is a standalone tree rather than an overlay.

**Documentation projects the released ids.** The documentation projections of the Daedal profile, the provider and Python SDK guides, the model-replay catalog example, and the package READMEs that state a default or an advisory catalog name the released routes. `deepseek-v4-pro` remains a valid legacy id and stays wherever it appears, including the pi-ai catalog fixtures that describe what the installed dependency still ships.

## Consequences

Deployments that name a retired id in their own `settings.yaml` keep working: the first-party API routes `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` to V4.1 Flash, and a user `models` list is self-contained. The shipped OpenRouter route serves the release rather than the dated predecessor, so a deployment that wants `deepseek/deepseek-v4-flash-0731:nitro` states that alias for itself.

Model discovery, the graphical model directory, and the ACP configuration surface report the released ids, so a client that recorded the retired ids refreshes them on the next directory read.

Recorded session snapshots keep the ids they were recorded with, because the model id is part of the replayed request header and its expected output; a fixture that read its model from a default (`snapshots/sdk/persistent-tools`) or pinned the retired vision id (`snapshots/session/read-image`, `snapshots/session/ptc-read-image`, `snapshots/acp/image-compaction`) moves with the default it mirrors.

The alias is a stopgap for dependency lag, not a stable fact: when pi-ai's catalog ships the V4.1 entry, the alias becomes unnecessary and the route can name the installed model directly. `docs/config-catalog.md` is generated from plugin JSDoc, so it restates catalog defaults only after the documentation gates regenerate it.

## Alternatives considered

- **Declare a `models` list for the OpenRouter route** — a configured `models` list replaces the served catalog for that route, so shipping V4.1 Flash this way would remove every other OpenRouter model from the graphical directory.
- **Upgrade pi-ai to a release that ships the V4.1 entry** — the correct long-term fix for the alias, but the dependency bump is a separate change with its own catalog drift gates and cannot be validated without registry access.
- **Keep the retired names and rely on server-side routing** — the first-party routes do route the retired names to V4.1 Flash today, but the harness would advertise a retired model as its default and lose the release's declared `max`/`low` efforts and native image capability in its advisory catalog.
- **Move the shipped default to the first-party route** — `deepseek-flash` on `deepseek-official` is the released name, but it changes the shipped credential from `OPENROUTER_API_KEY` to `DEEPSEEK_API_KEY` for every deployment that relies on the default.
- **Keep `deepseek-v4-flash-vision-exp` beside the new entry** — the model it named is retired, and V4.1 Flash accepts images natively, so a second entry would advertise a distinction the provider no longer makes.
- **Keep `reasoningEffort: xhigh` on the new default** — V4.1 Flash does not advertise `xhigh`, so the shipped default would name an effort the model does not offer.
