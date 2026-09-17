---
description: "Application Remote assembly: selects typed Host capabilities and forwarded events for Client consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-remotes

## Summary

Two-sided BFF for Host Remote capabilities selected by this application. The Host entry owns the forwarded-event selection and registers its application event source with API Gateway; the Client entry imports generated `/remote` artifacts as runtime values, mounts each contribution through `ctx.remote.$mount()`, and re-exports their declaration merges. Client business packages depend on this facade rather than the Gateway implementation or individual Remote runtime entries.

## Table of Contents

- [Use this package](#use-this-package)
- [Portable Client](#portable-client)
- [Installable Client distribution](#installable-client-distribution)
- [Forwarded Host events](#forwarded-host-events)
- [Build boundary](#build-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

[`@deepseek-ai/dsh-api-session-controller`](../session-controller/README.md) owns Agent and Session identity policy, including the Typert lookup resolvers used by other namespaces. This package only selects and mounts that generated Session contribution; it does not duplicate activation policy.

The Client assembly mounts Commands, credentials, settings, Goal, dynamic Cordis, file and Session references, read-only Host plugin inventory, message feedback, Session Controller, and Workspace Controller contributions. Cordis effect ownership withdraws every contribution when this assembly unloads, while `@deepseek-ai/dsh-api-gateway/client` owns descriptor validation, traced namespace Services, direct and scoped methods, invocation, streams, and cancellation. The Client entry consumes the shared `TypertClientRemote` interface through Cordis and does not import the concrete Gateway. It re-exports the Gateway Client face's declaration merges type-only, so a consumer reaching the forwarded-event vocabulary through this facade gains no runtime edge to the Gateway implementation.

This facade is also the front door for the wire type vocabulary a Client package names. It re-exports, type-only, the Remote failure vocabulary (`RemoteResult`, `RemoteFailure`, `RemoteErrorCode`, `RemoteErrorDetailsMap`), the Host facts (`RemoteHostFacts`), and each selected domain's client-safe payload types, so a Client feature package imports one specifier instead of reaching into `dsh-typert-protocol`, the Gateway, or an owner's Host entry. Two kinds of package deliberately skip this door: the api-layer packages this assembly itself selects — importing it back would close a dependency cycle — and their tests, which take the failure vocabulary from `dsh-typert-protocol` directly. A UI package's tests instead take the `RemoteError` constructor from [`dsh-client-test-runtime`](../../test-support/client-runtime/README.md).

This package owns no physical transport or Host service discovery. It projects the application selection into generated Remote contributions and an independent Host event source per Client; API Gateway owns endpoints, carriers, cancellation, and reconnection. Its Client face can be reused by Web or a future TUI that provides the same React-free `ctx.remote` contract.

## Portable Client

`@deepseek-ai/dsh-api-remotes/client/portable` is the portable application facade. It exports the shared Connection factories, Gateway installers and stream models, generated API types, and the Client registry installer (`applyRegistry` and `registryInject`). Applications compose these exports with one Cordis root per host. The Gateway installer requires the paired Host id; see [native Host admission](../gateway/README.md#portable-client) for readiness, cancellation and uncertain command outcomes. Its bundled declarations retain one identity for the selected Client types and do not require the Host implementation packages in the application typecheck.

`@deepseek-ai/dsh-api-remotes/client/portable` exports the same `inject`, `apply` and Client type vocabulary as the Web assembly through normal ESM. Mount it after the portable Typert registry and Gateway service. Cordis invokes its bound callback as a function after native async transforms and waits for every namespace to mount before reporting readiness. Its generated `/remote` contributions are bundled from the existing owner artifacts; Zod stays a declared runtime dependency shared by the composition. The entry has no browser loader or Host implementation dependency.

The namespace selection is a compiled application selection, not proof that a connected Host provides every method. The Host remains authoritative for configured capabilities and permission. Unloading the assembly withdraws its generated namespaces; a retained method cannot send another request after withdrawal. Mount `applyWorkspaces` with `workspaceInject` after the generated assembly to expose the shared `ctx.workspaces` model, command results and reconnecting Workspace projection. The Workspace model remains owned by [Workspace Controller](../workspace-controller/README.md); portable callers receive the same Host ordering and race resolution as Web callers. Mount `applySessions` with `sessionInject` and `SessionClientOptions` to expose the shared `ctx.sessions` object layer. Its caller supplies request IDs, the current device time zone and a hydrated selection store dedicated to this host. The facade also exports Connection's `claimDeviceEnrollment` and device grant types; [Connection](../../client/connection/README.md#device-enrollment) owns enrollment validation and Host authorization, while the application owns QR presentation and secure storage.

`selectRemoteCapabilities(endpoints)` derives a sorted, deduplicated admission requirement list from the same generated contributions that `apply` mounts. It runs before plugin installation and throws when a selected endpoint lacks a descriptor or schema/business evidence. Pass it as `requiredCapabilities` to `applyRemoteClient`; select the endpoints essential to the composition, while optional feature availability comes from `ctx.remote.$host.capabilities`. An explicit empty selection supports metadata-only compositions. The [Gateway admission rules](../gateway/README.md#portable-client) own readiness, activation checks and cancellation.

-----

## Installable Client distribution

`pnpm run pack:portable-client --out /absolute/new/directory` produces `@deepseek-ai/dsh-api-remotes-client` and five shared dependency archives from a clean committed checkout. The command clears repository build outputs and rebuilds both compiler faces before packing. Run it in a dedicated build checkout; the destination must be new and outside that checkout. Failed builds remove their owned output directory. The completed `manifest.json` records the source revision and SHA-256 of each archive. Add `--application` to produce `@deepseek-ai/dsh-client`, which also exposes the existing portable Conversation, Chat, pending-interaction registry and approval/question request consumers. This application package retains one compiled declaration graph, including Chat and pending-interaction type augmentations, with explicit shared dependencies. Approval and question carriers retain their original class identities and share the generated Remote and Session types. Install one distribution per application; independently bundled declaration copies can disagree about nominal service identities.

Install all six archives as direct file dependencies, retain the package-manager lockfile, and import from the selected package named by `manifest.json`'s `entry`. Registry dependencies remain Zod and Standard Schema. The distribution retains shared Cordis, Brand, Typert and value identities and carries no Host implementation dependency. Its JavaScript and declarations are the existing portable outputs without a second source implementation. The full Remotes package still declares its Host dependencies for its other entry points.

<a id="forwarded-host-events"></a>
## Forwarded Host events

`src/remote-events.ts` holds `API_REMOTE_FORWARDED_EVENTS`, the allowlist of Host Cordis events this application forwards without renaming, and therefore the legal key set of `ctx.remote.$on`; each entry also selects ordinary emission or Agent-scoped waterfall delivery. The type-only `src/types.ts` derives its selection face. Forwarding one more event requires one entry in that array: the type projection, consumer key face, and Host forwarding loop all derive from it.

The listener signature is not restated here. Each allowlisted event's Cordis `Events` declaration lives in its owner package's client-safe `./types` export, and both faces of this package pull those declarations in. The Host face additionally asserts every entry against `TypertForwardableEventEntry`: an `emit` entry must be a declared one-way event, while a `waterfall` entry must be a declared Agent-scoped waterfall whose final parameter is its same-result `next()` callback.

The Host entry registers an independent allowlist listener set and queue for each Client stream. It rejects non-JSON ordinary-event arguments before enqueueing. For a waterfall, it projects only the top-level Agent identity and JSON request fields; a Client result must also be lossless JSON, while `next()` delegates to the following Host listener. Each scoped waterfall request must carry its routed Agent directly as `request.agent`; the Host rejects a missing or mismatched identity before forwarding. The source attaches all listeners synchronously before `ctx.typertGateway.registerRemoteEvents()` exposes Gateway's internal `$events` logical stream, so its first `ready` item proves that incremental delivery is active and carries the Host home for Client path display plus `ctx.connection.identity`. The Host entry waits for both Gateway and Connection before registering the source. Withdrawing the registration aborts active streams.

<a id="build-boundary"></a>
## Build boundary

Most repository packages belong to one TypeScript face: Host packages are registered in the root `tsconfig.host.json`, and Client packages in the root `tsconfig.client.json`. This package splits because its Host entry must participate in the Host Typert graph, while `src/client/index.ts` cannot compile until Host tsdown has generated the business packages' `/remote` declarations.

This package's root `tsconfig.json` is only a solution that references `tsconfig.host.json` and `tsconfig.client.json`. The Host aggregate and direct Host consumers reference the former, while the Client aggregate and direct Client consumers reference the latter; the package-root solution must not enter either aggregate's dependency graph. The two projects own disjoint source files and `.tsbuildinfo` files but share the `lib/types` output directory, with one deliberate exception: `src/remote-events.ts` and `src/types.ts` are listed in BOTH faces' `files`, because the forwarded-event allowlist is the single control point over what a consumer can receive, and the Host forwarding loop and the Client `ctx.remote.$on` key face must read one declaration rather than two that could drift.

That exception is not just a `files` entry. The root `tsconfig.base.json` maps `@deepseek-ai/dsh-api-remotes/types` to `src/types.ts` — the source plane, like every other workspace subpath and unlike the generated `/remote` artifacts, which have no `paths` entry and resolve through `exports` to built output. Both faces therefore admit the same allowlist and type projection into their own programs and emit byte-identical `remote-events` and `types` outputs into `lib/types`; the `.tsbuildinfo` files stay independent. No gate enforces the faces' source-file disjointness — `scripts/project-reference-faces.ts` only checks that a reference into a split project names the matching face — so this paragraph records why the double listing is intentional.

The package-local `clientBundle(..., { hostPhase: true })` makes Host tsdown bundle the Host entry and the later Client tsdown bundle the browser entry plus its portable Client companion. Client companions run only after Client TypeScript output exists; they cannot be emitted during the earlier Host phase. Ordinary Client plugins remain single Client projects and produce both their Node loader entry and browser bundle during Client tsdown; split only when the two source sets require different compiler faces.

The application facade also exports the shared [prompt admission observer](../session-controller/README.md#use-this-package) for correlating uncertain submissions with authoritative Session facts.

<a id="model-experience"></a>
## Model Experience

None, as this BFF selects Remote application methods and forwarded events but registers nothing model-facing.

#### KV Cache effect

No direct effect; mounted Host capabilities own any model-visible behavior they trigger.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Generated Client methods are fixed by explicit build-time value imports. The portable facade exports `readHostCapabilities()` for advisory, identity-bound discovery of current strict Host endpoints; it does not mount new Client methods or establish domain schema compatibility. The capability envelope is version 3 and retains optional wire fingerprints and business revisions. Generated calls use the Gateway's [operation compatibility checks](../gateway/README.md#operation-compatibility); capability reads remain advisory and grant no authorization.
- Additional capabilities require an explicit `/remote` value import and mount in this assembly.
- Ordinary forwarded events are not replayed; state that requires reliable recovery needs an owner-provided query, cursor, or opening baseline.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Typert and the Agent/Session registries own the observed relationships.
