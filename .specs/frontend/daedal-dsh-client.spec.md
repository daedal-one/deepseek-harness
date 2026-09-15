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

## Host identity

The Connection identity response distinguishes one durable credential-store Host identity from one application-root activation. Network addresses and display names are not identities. Reading the response requires the carrier's existing authorization; a response alone grants no access. Its envelope version describes only identity fields, not the DSH API or Session compatibility contract. The native Remote installer requires a paired Host id and validates the identity on its actual authenticated stream before accepting a connection generation. Generated native calls and streams require that matching generation; losing it cancels active operations and rejects late results without replay. A new activation of the same Host can reconnect. The Gateway opening protocol is versioned independently from identity fields, Session data and domain API compatibility; the latter two remain separately negotiated requirements.

## Session compatibility

An opening snapshot must carry the logical Session format supported by the Client; older, newer or absent format versions are refused before publication. Each Client uses its own generated Session event vocabulary when reading snapshots, live events and history pages. It refuses unknown required event types before publication without retrying or advancing the accepted journal window. An explicit ignorable marker permits opaque event retention; an API or Session format version alone does not establish support for a newly added required event.

## Sources

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
