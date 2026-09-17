---
description: "Typed Client-to-Host calls and streams: dispatch, validation, cancellation, reconnection, and forwarded Host events."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gateway

## Summary

Two-sided Typert RPC endpoint for Host and Client Cordis environments. The Host entry provides `ctx.typertGateway`, while `@deepseek-ai/dsh-api-gateway/client` provides `ctx.remote`; both consume the same generated `InvocationDescriptor` contract and leave business selection to API Remotes. Connection carries unary request correlation, trust, and response envelopes, while Gateway owns multiplexed Remote streams.

## Table of Contents

- [Host service: `TypertGatewayService` (ctx key: `typertGateway`)](#host-service-typertgatewayservice-ctx-key-typertgateway)
- [Operation compatibility](#operation-compatibility)
- [Client service: `ClientRemote` (ctx key: `remote`)](#client-service-clientremote-ctx-key-remote)
- [Portable Client](#portable-client)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="host-service-typertgatewayservice-ctx-key-typertgateway"></a>
## Host service: `TypertGatewayService` (ctx key: `typertGateway`)

`ctx.typertGateway.invoke()` resolves the current descriptor and Cordis Service for each call, validates exact named arguments, resolves registered object or Context identities, invokes the public business method, and validates its result. Business Services extend `TypertRemoteService` and mark methods with `@Remote` or `@RemoteScope` from [`dsh-typert-protocol`](../../typert/protocol/README.md); `bindTypertRemote()` remains available when another base class owns inheritance.

Strict mode reads generated invocation descriptors from `ctx.typert.local`. Lookup parameters use the currently active resolver in `ctx.typert.lookups`: the business package registers the stable declaration and default policy, while Host composition can override resolution behavior with effect-scoped `configure()`; `@RemoteScope` resolves its receiver through a registered Host Context adapter. SRC mode is a development fallback for endpoints that have never had a strict definition; it parses simple parameter names and accepts only JSON-safe values for non-lookup parameters. Withdrawing an observed strict definition fails instead of weakening validation.

The Host package declares Connection as a peer for its shared Host identity validators. The Host entry registers a trusted-host interceptor on Connection's shared `/api` FetchHandler. Connection passes this composite handler through its HTTP bridge; the handler dispatches claimed endpoints to Gateway and returns 404 for unclaimed requests unless an exact Fetch route owns them. Direct `invoke()` calls preserve business errors; `TypertGatewayError` is a `RemoteError` subclass whose `gateway/*` codes name the failures owned by dispatch, binding, providers, lookup, Context, arguments, and codecs. A resolver that refuses on policy grounds — a cold-resume failure or an ownership fence — throws its own `RemoteError`, and the code it chose reaches the caller unchanged.

A cancellation-aware Remote method declares `signal: AbortSignal` as its final Host parameter. The signal is descriptor metadata rather than a wire argument: Connection supplies it to the Gateway, and the Gateway injects it after decoded business parameters. SRC recognizes the reserved final name, while strict generation additionally requires the global `AbortSignal` type.

Gateway refuses an already-cancelled invocation before preparation and checks cancellation again before business execution after asynchronous Context or lookup resolution. A Connection device lease binds an authenticated WebSocket to that device: revocation synchronously cancels its logical-stream signals and destroys the socket, without waiting for its close event. Cancelling a carrier cannot undo business work already accepted.

A stream Remote uses `@Remote({ mode: 'stream' })` and returns an `Iterable` or `AsyncIterable`. `ctx.typertGateway.stream()` applies the same endpoint, argument, lookup, and cancellation checks as unary invocation, then validates each yielded item with the generated result codec. The Client opens the Gateway-owned `/api/remote.mux` WebSocket when its plugin activates and keeps it connected while idle. Connection owns the retry schedule; before each retry it asks the mux to cancel any candidate or active socket and make exactly one fresh physical attempt. The Host sends Ping control frames at the configured `websocketHeartbeatIntervalMs` interval (two seconds by default), and the browser answers Pong at the WebSocket protocol layer, so idle network intermediaries see traffic without any Remote stream frame. A socket that has not answered the previous Ping is terminated at the next interval. Independently cancellable logical streams share that socket; an in-process Connection carrier provides equivalent streams directly without opening it.

Host composition can register one application event source through `registerRemoteEvents()`. Gateway reserves the internal `$events` logical endpoint for that source, accepts only empty `args`, and aborts streams opened by the registration when the source is withdrawn. API Remotes owns the event selection, argument validation, per-Client queues, and the Host home sent in the opening `{ type: 'ready', protocolVersion, clientId, host: { home, identity } }` frame. Its source factory attaches incremental listeners synchronously, so the Client publishes the generation and starts baseline reads only after incremental delivery is ready.

The Gateway capability query lists the currently registered, fully strict Host Remote endpoints in code-point order. Each row carries its unary/stream mode and `available`, `context-required` or `unavailable` state. Direct methods check the live service, binding, implementation and lookup declarations. Context methods check their Host adapter and lookup declarations without resolving a receiver; service availability inside a specific Context remains unknown. Discovery invokes no resolver or business method. SRC inference and descriptors with SRC codecs are excluded. Availability describes dispatch prerequisites only; every actual call still applies current validation and authorization.

The authenticated `$capabilities` Connection RPC accepts `{}` and returns `{ version: 3, identity, capabilities }`. Unavailable rows contain a fixed `service`, `binding`, `method`, `lookup` or `context` reason. Rows preserve optional generated `wireFingerprint` and authored `semanticRevision` fields; absence means compatibility is unverified. Clients reject older metadata envelopes. The response omits local paths, provider credentials and runtime object identities. Metadata version is independent of domain API schemas; this snapshot is not an API compatibility proof. See the [capability discovery decision](../../../.agents/notes/implemented/architecture/2026-09-15-host-capability-discovery.md).

## Operation compatibility

Generated Client calls carry `compatibility: { wireFingerprint, semanticRevision }` beside their named `args`. Native calls require both fields before sending and add the pinned Connection `identity`, including its activation. The Host validates the wire envelope and compares it against the current strict descriptor and optional identity before Context or lookup resolution. It rechecks descriptor identity and expectations after asynchronous preparation, immediately before invoking the retained method. A withdrawn or replaced descriptor refuses the request even when the replacement has equal metadata. Unary and stream refusals use `gateway/api-incompatible` and never enter the business method or retry the operation. An already accepted operation retains its original method; subsequent calls select the live descriptor.

Callers omitting expectations retain unnegotiated Web and source dispatch. Expectations are compatibility checks, not authorization. Native generation admission and its required capability selection remain separate from this operation check. Business revisions follow the [generator policy](../../typert/generator/README.md#business-revisions). See the [dispatch decision](../../../.agents/notes/implemented/architecture/2026-09-16-remote-operation-compatibility.md).

<a id="client-service-clientremote-ctx-key-remote"></a>
## Client service: `ClientRemote` (ctx key: `remote`)

`ctx.remote.$mount()` validates and registers a generated Host-for-Client contribution, then installs concrete direct and scoped methods for the calling Cordis fiber. Each namespace is a traced `remote.<namespace>` child Service and unloads after its last method is withdrawn. Duplicate endpoints, namespace collisions, and descriptors without strict generated codecs fail before methods become callable.

Each unary call validates positional inputs, constructs the descriptor's exact named `args`, and sends it through `ctx.connection.rpc.call('/api', endpoint, ...)`. A generated stream method returns an `AsyncIterable` and opens one logical stream through an in-process Connection carrier when available, otherwise through the shared Gateway WebSocket. Generated cancellation-aware methods accept a final optional `AbortSignal`; the Client combines it with the contribution mount lifetime before invoking the carrier. Unary results and every stream item are validated before reaching application code. Withdrawing a contribution removes its descriptors and methods together, aborts in-flight calls and streams, and makes retained method handles reject.

Every unary call resolves to `RemoteResult<T>` — `{ ok: true, value }` or `{ ok: false, error }` — and never rejects for a carrier problem: this face folds an offline carrier into the error branch and answers `gateway/cancelled` when the caller's signal aborts, so no consumer wraps a call to recover one. Only an assembly fault still rejects: wrong arity, an unmounted method, a withdrawn contribution, a missing Context adapter. `error` is a live `RemoteError` instance, so `throw result.error` keeps throw semantics, and `isRemoteFailure(value)` is the one predicate a consumer needs — a caught value it accepts carries a Host code, and anything it rejects is a local fault the caller should let crash.

`ctx.remote.$host` reads the fixed Host facts as plain values: `home`, `identity`, the admitted native `capabilities` snapshot, and fixed `isLoopback`. Disconnected generations expose no home, identity or capabilities. It is not a store — no subscription, no generation counter — so a consumer that must react to reconnection listens for `connection/reset` instead of polling it.

`ctx.remote.$stream()` returns a single-consumer `RemoteStream` spanning physical carrier generations. It permits one immediate retry while the Host remains available, otherwise waits for the next connected Host generation, and annotates each item with its physical generation. The domain consumer validates and accepts each generation's opening value; business and protocol failures remain terminal. Every terminal failure leaves this face as a `RemoteError`, including exhausted carrier retries and a generation that ends before its opening value, so a stream consumer discriminates the same way a unary caller does. `RemoteStreamCarrierError` names a retryable physical loss and reaches a domain only as the `carrierFailed` callback argument, never as a terminal outcome. `RemoteSnapshotStream` adds one opening snapshot followed by deltas. `RemoteJournalStream` adds follow-before-page opening, pagination, reconnect catch-up, and gap repair over domain-defined inclusive entry ranges; it removes complete duplicates and rejects gaps, inverted ranges, and partial overlaps. A domain may also carry cursorless notifications: they never advance or repair the durable cursor, and notifications received during gap repair publish only after the replacement page commits. If a newer generation supersedes that repair, held notifications from the superseded generation are discarded with its page. Disposing any stream cancels its requests and resolves after the active iterator is fully stopped.

`ctx.remote.$on()` subscribes to one forwarded Host event. Its legal keys are exactly the Host assembly's forwarding selection, and the listener type is the owning package's own Cordis `Events` declaration, so no second signature can drift from it. Each subscription belongs to the calling fiber and disappears with it. The Client Remote service registers the `$events` pump as a Connection generation source when it activates, whether any `$on` listener exists. Browsers use Remote mux, while in-process compositions use `connection.rpc.open`; the opening `ready` item establishes a Connection generation and supplies its Host facts. Carrier failure, Remote stream failure, unexpected normal completion, a non-ready opening item, or a malformed event item ends that generation and lets Connection reopen it under continuous, capped jittered exponential backoff. Ordinary notifications run in registration order and isolate listener failures. Agent-scoped waterfalls let a listener return a result, call `next()`, or reject; Gateway returns that outcome through the existing HTTP unary carrier.

`ctx.remote` exposes no Connection lifecycle control. A consumer whose responsibility includes recovery reads `ctx.connection.state` and calls `ctx.connection.reconnect()` directly; ordinary Remote consumers stay on generated namespaces and `$stream()`.

Generated declaration merges provide the TypeScript API through the shared `TypertClientRemote` contract. The Client entry contains no Host Service or Host Cordis interface merge, and method lookup and invocation use ordinary objects and functions rather than a JavaScript Proxy.

## Portable Client

Supervised native read streams wait when the paired Host has no admitted generation and reopen through their existing baseline or cursor policy after generation loss. A different admitted Host remains a terminal refusal. Unary operations remain single-send and retain uncertain outcomes after a lost response.

The event stream opens with `protocolVersion: 1` and the Connection-owned Host identity. This version describes the Gateway opening fields; it does not negotiate Session or domain API compatibility. `ctx.remote.$host.identity` exposes the validated active identity and becomes undefined after generation loss.

`@deepseek-ai/dsh-api-gateway/client/portable` exports `createRemoteStreamMux({ baseUrl, createSocket, randomId })` as normal ESM. The caller supplies an HTTP(S) host URL, authenticated socket adapter and a fresh correlation identity per logical stream. The factory fixes the `/api/remote.mux` route and rejects unsupported schemes or URL credentials before opening a socket. Connection owns calls to `start()` and `reconnect()`; the carrier does not retry or replay logical streams. `close()` permanently stops only this instance. The Web plugin supplies page defaults to the same implementation. Both Client entries expose the same Remote stream classes and capability declarations.

`open(endpoint, payload, signal)` accepts the platform's abort state and event listeners without requiring `throwIfAborted()`. A supplied reason is retained; signals without a reason property reject with an `AbortError`. The adapter's lifecycle events must begin after socket construction returns. The entry also exports `applyRemoteClient(ctx, { ...transport, expectedHostId, requiredCapabilities, createAbortController })`, the `inject` service requirements, and Gateway's stream, journal and snapshot supervisors. Mount it in a Cordis fiber with Typert and Connection services; `ctx.remote` then uses the same generated contribution validation, invocation and event forwarding as the Web plugin. Disposal withdraws the fiber's registrations and stops its transport. The caller supplies the paired `expectedHostId`; the installer refuses a different or missing Host identity and unsupported opening protocol before publishing a generation. Authentication and business contribution selection remain caller-owned. Generated native calls and streams require a matching ready generation. Losing it aborts their transport signals and rejects late results without replaying the operation; an accepted command can therefore have an uncertain outcome. Settlement releases the generation observer and cancellation listeners. A new activation of the same paired Host may reconnect. Browser and private DesktopHost compositions retain origin/private-carrier authorization and still validate the opening frame.

The native installer snapshots its explicit `requiredCapabilities` selection before transport startup. After a valid paired opening, it reads `$capabilities` for the same Host activation and generation lifetime. Every required endpoint must match mode, generated wire fingerprint and semantic revision and be available or context-required; otherwise admission fails with `gateway/api-incompatible`. Invalid metadata, identity mismatch and authorization refusal preserve their distinct failures. Readiness and forwarded events wait for successful admission. An empty selection permits metadata-only compositions; unavailable optional endpoints remain in the accepted snapshot. `ctx.remote.$host.capabilities` exposes that snapshot only during its accepted generation. Disconnect cancels admission, including a carrier that settles late, and reconnect reads fresh metadata. Per-operation checks still reject descriptors withdrawn or changed after admission; a snapshot grants no authority. The application assembly [selects requirements from generated contributions](../remotes/README.md#portable-client).

`readHostCapabilities(rpc, expectedIdentity, signal?)` is available from both Client entries. It validates the full response, unique sorted endpoints and both Host and activation identities. The caller owns the lifetime and cancels it when the admitted generation ends; cancellation is checked before dispatch and before accepting a response. Host refusal and carrier rejection propagate without retry. Malformed metadata and identity mismatches return explicit Connection RPC failures. The helper requires a signal with `throwIfAborted()` when one is supplied.

The complete Client service requires fresh controllers preserving abort reasons and `throwIfAborted()`. Its explicit factory also reaches stream supervisors and mounted methods. Cancellation composition uses operation-owned listeners and releases them on settlement or disposal, without requiring `AbortSignal.any()`. React Native 0.81's bundled controller lacks reasons and `throwIfAborted()`; the native adapter must supply those on its own controller instances. The physical carrier alone accepts the platform's smaller signal subset. See the [portable client decision](../../../.agents/notes/implemented/architecture/2026-09-15-portable-client-connections.md).

<a id="model-experience"></a>
## Model Experience

None, as the package dispatches application calls and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; invoked business Services own any model-visible result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Connection adapter answers `gateway/internal` with empty details for dispatch failures and unclassified exceptions; a `RemoteError` thrown by an owner or by Gateway itself crosses the wire with its own code, message, and details. Its `cause` chain and the `TypertGatewayError` subclass identity survive only for same-process callers.
- SRC mode supports unique identifier parameters without destructuring, defaults, or rest parameters. It validates JSON safety rather than generated business types and never infers optional fields.
- Only strict generated contributions can mount on the Client face. SRC markers have no Client codec or type projection.
- `$stream()` supervises carrier replacement but does not infer replay semantics; each domain owns its resume cursor or replacement-baseline validation and normal-end classification. Connection generations reopen the internal `$events` stream; one-way notifications are not replayed, while pending scoped waterfalls retain their event id across replay.
- Lookup resolvers are configured per key; an individual Remote parameter or endpoint cannot currently select a live-only policy under the same `agent`/`session` key.
- Forwarded events reach `$on` without business-payload projection or redaction. Ordinary notifications are not replayed after reconnect; Agent-scoped waterfalls project only the top-level Agent identity needed to select the Client Context and carry their own pending lifetime.
- `websocketHeartbeatIntervalMs` is both the Ping cadence and the Pong deadline. The Host terminates a peer that does not answer before the next interval, so a deployment whose event loop or network can stall longer than this interval must raise it.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Host calls re-read authoritative Cordis and Typert state, while Client methods, descriptors, and `$on` subscriptions mutate in one owned effect.
