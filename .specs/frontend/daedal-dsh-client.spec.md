---
id: IFC:frontend/daedal-dsh-client
type: interface
status: accepted
summary: "Expose native DSH connection and control semantics to portable frontend consumers."
owners: [carlo]
stability: experimental
related: [REQ:frontend/daedal-dsh]
---

# Daedal DSH native client

:::{interface id="daedal-dsh-client" level="MUST"}
The native client API MUST expose host identity, session/workspace identity, API and session-wire compatibility, and configured capabilities independently of the frontend marketing version. Portable imports MUST NOT require Node or browser DOM execution on native mobile. Transport adapters MUST preserve unary RPC, stream ordering, paging, deferred details, interaction forwarding, cancellation, disposal and backpressure.

An accepted command whose response is lost MUST remain an uncertain outcome until deduplicated or reconciled. Resolved or withdrawn interaction requests MUST reject late responses. Capability and permission checks MUST remain server-owned. Native and browser clients MUST NOT receive provider secrets or arbitrary privileged desktop operations. Managed desktop transport MUST preserve the private DesktopHost protocol and exclusive runtime ownership.
:::

## Consumers and compatibility

The Daedal DSH fork consumes this supported DSH client face. The current Web client remains a consumer during migration. Package extraction is chosen from executable native import evidence rather than copied schemas or a broad polyfill layer. Missing operations are added to their owning DSH service and Remote controllers.

## Installable Client distribution

Produce a DSH-owned portable Client distribution from the existing generated facade runtime and bundled declarations. Its manifest includes only the shared portable runtime and nominal type dependencies; installing it must not fetch Host implementations. Keep Cordis, Brand and Typert identities shared with the consumer. Do not copy wire schemas or maintain a second implementation in the frontend. A clean committed source revision, a fresh build and checksums identify every supplied archive, including unpublished shared dependencies. The frontend pins those archives and its lockfile. Qualification must include a real clean package-manager install, strict declaration consumption, runtime imports and the actual mobile bundler; unpacked archives alone do not establish installability.

## Host identity

The Connection identity response distinguishes one durable credential-store Host identity from one application-root activation. Network addresses and display names are not identities. Reading the response requires the carrier's existing authorization; a response alone grants no access. Its envelope version describes only identity fields, not the DSH API or Session compatibility contract. The native Remote installer requires a paired Host id and validates the identity on its actual authenticated stream before accepting a connection generation. Generated native calls and streams require that matching generation; losing it cancels active operations and rejects late results without replay. A new activation of the same Host can reconnect. The Gateway opening protocol is versioned independently from identity fields, Session data and domain API compatibility; the latter two remain separately negotiated requirements.

## Session compatibility

An opening snapshot must carry the logical Session format supported by the Client; older, newer or absent format versions are refused before publication. Each Client uses its own generated Session event vocabulary when reading snapshots, live events and history pages. It refuses unknown required event types before publication without retrying or advancing the accepted journal window. An explicit ignorable marker permits opaque event retention; an API or Session format version alone does not establish support for a newly added required event.

## Host capabilities

The authenticated `$capabilities` query reports a sorted snapshot of fully strict Host Remote endpoints and their dispatch prerequisites. Direct methods distinguish available from unavailable service, binding, method or lookup support. Context methods report context-required only when the Host Context declaration matches; receiver availability remains unknown until a concrete Context resolves. Discovery must not resolve objects or Contexts or invoke business methods. The response contains only protocol metadata, Host identity and endpoint capability facts. Its version describes the metadata envelope, not domain API schemas. Clients validate the response and match both the expected Host and activation; they own cancellation across generation changes. Reading capabilities does not grant permissions or guarantee a later call.

## Domain schema evidence

Generated Host and Client descriptors carry the same versioned per-endpoint wire fingerprint. It hashes the endpoint's resolved codec projection and invocation fields, including referenced type definitions, rather than type-symbol names or the whole package. Source location, declaration spelling, documentation and unrelated endpoints do not affect it. Changes to accepted wire arguments, lookup or Context selection, cancellation and result codecs change it. The authenticated capability response preserves this optional fingerprint; absence means no schema evidence. Exact matches establish only conservative generated-schema equivalence. Business semantics use a separate revision policy; full generation admission remains required before native release. Host availability, authorization, Session format and required event vocabulary remain separate checks.

## Operation compatibility

Remote methods start at business semantic revision 1. An explicit positive safe integer `@remoteRevision` annotation changes that revision when observable behavior becomes incompatible without a codec change. The generator emits the resolved revision independently of the wire fingerprint; neither field substitutes for the other. Generated Client calls carry both expectations and native calls also carry the admitted Host identity and activation. Native dispatch refuses absent evidence before sending a domain operation. The Host compares expectations to its live strict descriptor and identity before resolving Contexts or lookups, and rechecks the same descriptor before business execution after asynchronous preparation. Mismatch refuses unary and stream operations without business execution or automatic retry. Calls that omit expectations retain the existing unnegotiated Web/source route during migration. Authenticated capability metadata carries optional semantic revisions; absence remains unverified. Native generation admission uses the explicit Client requirement set below.

## Generation admission

Native composition explicitly selects required endpoints from the same generated contributions that it mounts. The requirement records contain endpoint, unary or stream mode, wire fingerprint and semantic revision; no Host response supplies Client expectations. On each authenticated event-stream opening, validate the paired Host and read capability metadata for that exact activation before publishing readiness or delivering forwarded events. Every required endpoint must match mode, schema and business revision and be available or context-required. Missing, unverified, unavailable or incompatible required endpoints refuse admission; unrelated optional capabilities do not block it. An explicit empty requirement list admits metadata-only compositions. The accepted snapshot is visible only for its active generation and disappears on loss. Cancellation and late metadata responses cannot publish readiness; reconnect repeats admission. Per-operation Host enforcement and Session format/event checks remain authoritative after admission.

## Device enrollment and revocation

Connection owns an opt-in device-access configuration with explicit enrollment lifetime, pending-challenge limit and enrolled-device limit. The Web composition supplies those values. Browser-authenticated owner requests may create a challenge, list device metadata and revoke a device. Device bearer credentials cannot perform those administrative operations or mint other credentials. Existing browser cookies, index authentication, Host/Origin checks and private DesktopHost transport retain their policies.

An exact enrollment-claim POST is the only unauthenticated API exception and still passes the Host/Origin fence. Its request carries the expected Host id, single-use challenge and bounded device label in JSON. Challenges use cryptographic randomness, expire by elapsed time, stay in memory only and are consumed before durable grant creation. Restarts and plugin reloads invalidate outstanding challenges. A failed or lost claim never causes automatic replay or returns a second credential. QR data carries only the short-lived challenge, expected Host identity and selected origin; permanent credentials never enter QR codes or URLs.

A successful claim returns a random device bearer credential once, only after the credential provider commits its Host-bound record. Persist only a digest and bounded device metadata, never the bearer secret or enrollment challenge. Stored versions and fields validate on load and every admission; malformed state fails closed. Administrative listing never exposes hashes or secrets. Device authorization uses the Authorization header for API requests and WebSocket upgrades, never query strings, and never falls back to a browser cookie when a supplied bearer is invalid.

Every accepted device request owns a revocation lifetime. A committed revoke rejects future requests and cancels that device's active HTTP and WebSocket carriers; other devices and browser sessions remain valid. Credential-record changes reconcile active grants, and malformed or removed state cancels affected access. Abort before dispatch or after asynchronous Context/lookup preparation prevents business execution; an operation already accepted may have an uncertain outcome and cannot be undone by revocation. Teardown stops new admission, cancels active leases, clears challenges and waits for owned work. Privileged browser-only auxiliary routes retain their current policy.

Portable claim validation binds the returned grant to the expected Host and respects caller cancellation before accepting credentials. Native storage, the QR presentation and discovery remain separate application work. Live public-profile qualification must prove single-use enrollment, bearer access to identity/capabilities and native generation admission, durable credentials across restart, revocation of active streams and rejection of revoked or wrong-Host credentials. Keep physical iPhone acceptance distinct from local and fixture checks.

## Sources

- [Device grant persistence and revocation](spec:src:packages/client/connection/src/device-access.ts)
- [Device enrollment routes](spec:src:packages/client/connection/src/device-routes.ts)
- [Device wire validation](spec:src:packages/client/connection/src/device-protocol.ts)
- [Portable enrollment claim](spec:src:packages/client/connection/src/client/device-access.ts)

- [Generated wire fingerprints](spec:src:packages/typert/generator/src/emitter.ts)
- [Portable Host capability read](spec:src:packages/api/gateway/src/client/host-capabilities.ts)
- [Capability wire validation](spec:src:packages/api/gateway/src/capabilities-protocol.ts)
- [Client Session wire acceptance](spec:src:packages/api/session-controller/src/client/session-wire-event.ts)
- [Pinned native generation lifetime](spec:src:packages/api/gateway/src/client/pinned-generation.ts)
- [Durable Host identity](spec:src:packages/client/connection/src/host-identity.ts)
- [Shared identity envelope](spec:src:packages/client/connection/src/host-identity-protocol.ts)
- [Portable authenticated identity read](spec:src:packages/client/connection/src/client/host-identity.ts)
- [Portable Connection factory](spec:src:packages/client/connection/src/client/portable.ts)
- [Portable Gateway stream factory](spec:src:packages/api/gateway/src/client/portable.ts)
- [Connection client](spec:src:packages/client/connection/src/client/connection.ts)
- [Remote client](spec:src:packages/api/remotes/src/client/index.ts)
- [Portable generated Remote assembly](spec:src:packages/api/remotes/src/client/portable.ts)
- [Portable Client Typert registry](spec:src:packages/typert/registry/src/client/portable.ts)
- [Shared Gateway Remote service](spec:src:packages/api/gateway/src/client/service.ts)
- [Gateway stream client](spec:src:packages/api/gateway/src/client/stream-client.ts)

## Verification

The same native session flow runs through mobile networking, browser transport and the managed DesktopHost adapter. Tests cover incompatible handshakes, lost responses, duplicate interaction decisions, large deferred results, authentication expiry and transport teardown.
