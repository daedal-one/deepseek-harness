# Agent Note: Credential-aware default model route

Status: implemented

## Problem

The shipped default route named `provider: openrouter`, `model: deepseek/deepseek-v4.1-flash` with `reasoningEffort: high`, so it needed `OPENROUTER_API_KEY`. The product's own documentation and commands told users to set `DEEPSEEK_API_KEY`, and the mounted first-party `deepseek-official` adapter (`deepseek-flash`, `deepseek-v4-pro`) was unreachable from that default. A deployment holding only `DEEPSEEK_API_KEY` failed its first turn with `MISSING_CREDENTIAL` naming `OPENROUTER_API_KEY`, and composition had no way to say that a route depends on a credential at all: the plugin accepted only a provider, a model, and an effort.

## Decision

[`dsh-agent-default-model`](../../../../packages/core/agent-default-model/README.md) accepts `credentialRef`, the reference its primary route's adapter resolves, together with ordered `fallbacks`, each `{ provider, model, reasoningEffort?, credentialRef }`. The two are declared together: a fallback list without `credentialRef` and a `credentialRef` without a fallback fail at plugin load, and the config schema rejects a reference outside the credential seam's grammar.

The plugin injects the optional credentials service, reads presence with `describe` (which reports a reference without returning its value), starts that read when the service mounts, and repeats it on every committed `credentials/reference-updated`. One private read, `deploymentRoute(target)`, serves every consumer path — `currentSelection`, `registerTarget` inheritance, `list`, `validateSelection`, and `saveSelection` — and returns the first fallback whose reference is present while the primary's is not, otherwise the target's own default. Only the main route substitutes; preset and named routes keep the composition provider they were given, per the [preset-specific provider note](2026-08-21-preset-specific-agent-model-providers.md). A stored user selection stays provider-free and is projected under whichever provider the main route currently names, which is the provider a graphical save validated against.

The [base bundle](../../../../packages/bundle/base/cordis.patch.yml) ships the OpenRouter primary keyed on `OPENROUTER_API_KEY` and a `deepseek-official` fallback keyed on `DEEPSEEK_API_KEY` (`deepseek-flash`, `reasoningEffort: high`).

Failure keeps today's behavior exactly. With no credentials service, with no completed presence read, or with neither declared reference resolving, the effective main route is the configured primary route byte for byte, so a request without either key still fails loud with `MISSING_CREDENTIAL` naming the primary reference, and keyless snapshots and existing tests are unchanged.

## Alternatives considered

**Read the environment directly (`process.env.DEEPSEEK_API_KEY`).** The credential plane layers the managed `$DSH_HOME/.credentials.yaml` and project and user `.env` files over the inherited environment, so a direct read would miss a key stored from the Models page and would disagree with the rule the adapters themselves apply when they raise `MISSING_CREDENTIAL`. `describe` is the seam's presence read, shared with every other consumer of the same reference, and it cannot leak the value.

**Let the LLM adapter choose the route per request.** The route is part of the request header logged when the Agent is created; an adapter that substituted later would make the logged header disagree with the request it describes and would put a deployment default inside a provider adapter.

**Move the shipped default to the first-party route.** The [V4.1 Flash migration note](../architecture/2026-09-10-deepseek-v4-1-flash-model-migration.md) rejected this because it changes the credential every deployment relying on the default must hold. Credential-aware selection keeps OpenRouter as the shipped route and substitutes only when its key is absent.

**Make the selection an async resolve step the entry points await.** Every current consumer reads the route synchronously at creation time — the session controller, the headless runner, the webhook session ingress, and the preset catalog all call `mainSelection` or `currentSelection` directly. An async twin would either have no caller or force changes through those packages for an unchanged public surface. The event-maintained presence read keeps the synchronous contract and still reaches the next creation after a key is stored.

**Re-read presence from a file watcher or a timer.** The seam already publishes committed reference changes with contained listener failures; a second observation path would be a competing authority for the same fact and would need its own lifecycle and teardown.

**Substitute for any target whose provider lacks a credential.** Named and preset targets are deployment-pinned provider choices with their own catalogs, settings ids, and saved selections; substituting there would move a saved model onto a provider that never served it. The mechanism is scoped to the main route and says so in its JSDoc.

## Consequences

A deployment holding `OPENROUTER_API_KEY` sees no change at all; a deployment holding only `DEEPSEEK_API_KEY` starts on `deepseek-official/deepseek-flash` with `reasoningEffort: high`; a keyless run keeps the primary route and fails with the same `MISSING_CREDENTIAL` as before. The graphical directory reports the effective provider and its catalog, so a save validates against the route the next Agent will actually use.

The observation model has three costs, all recorded in the package README's known limitations. A creation that beats the first completed presence read keeps the primary route, so the fail-loud direction is preserved rather than guessed. A named role that inherited the main default captured that route when it registered and does not follow a later credential change. The settings section's composition base stays on the configured primary route while the directory reports the effective one, because the base is the deployment's declared route and not a credential observation.

Keyless lanes inherit the process environment, so a scenario that lets the base row supply its route now depends on an ambient `DEEPSEEK_API_KEY`: web and snapshot scenarios recorded against the OpenRouter primary, and lanes that mask only `OPENROUTER_API_KEY` to assert the missing-credential path, stay keyless only while the lane also masks the DeepSeek key or pins the `agent-default-model` row. On a host that exports neither key, nothing changes.

The pi-ai `modelAliases` override stays. The installed `@earendil-works/pi-ai` 0.85.1 OpenRouter catalog serves `deepseek/deepseek-v4-flash` (with `-0731`, `-0731:batch`, and `-vision-exp`) and no V4.1 entry, and `modelAliases` refuses a `catalogModel` the installed catalog does not describe, which is why the alias exists; the base row comment now states that reason. The published 1.1.0 catalog does carry `deepseek/deepseek-v4.1-flash`, but it keys OpenRouter entries with a `chat:` type prefix, so retiring the alias is a dependency bump that also adapts the adapter's catalog lookup, carries its own release-age exemption in `pnpm-workspace.yaml`, and is outside this change.
