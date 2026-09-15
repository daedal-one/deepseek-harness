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

## Sources

- [Connection client](spec:src:packages/client/connection/src/client/connection.ts)
- [Remote client](spec:src:packages/api/remotes/src/client/index.ts)
- [Gateway stream client](spec:src:packages/api/gateway/src/client/stream-client.ts)

## Verification

The same native session flow runs through mobile networking, browser transport and the managed DesktopHost adapter. Tests cover incompatible handshakes, lost responses, duplicate interaction decisions, large deferred results, authentication expiry and transport teardown.
