# Agent Note: Advisory Host capability discovery

Status: implemented

## Problem

A Client can compile methods whose Host services are absent, withdrawn or scoped to a particular Session. A generated Client selection therefore cannot describe the current Host's supported operations. Probing business methods to find support can also mutate state or invoke identity resolution policy.

## Decision

Gateway reports registered, fully strict Host Remote endpoints through an authenticated capability query. Direct availability checks current dispatch prerequisites. Context methods report that a receiver Context is required when their adapter matches; discovery never resolves that Context or guesses whether its service exists. Lookup declarations are checked without invoking their resolvers. SRC inference and incomplete strict definitions are excluded.

The response is an advisory snapshot, bound to Connection's Host and activation identities. Clients validate the whole envelope and its unique sorted endpoints, and callers cancel reads with the admitted generation. A successful read neither grants authority nor promises that a later call will succeed. Actual dispatch continues to resolve current services, apply policy and validate arguments. Metadata version describes the response fields; it cannot establish domain schema compatibility.

## Alternatives considered

**Advertise the compiled Client catalog.** It says what the app can call, not what the selected Host currently provides.

**Resolve a sample Session during discovery.** Resolution can run policy or perform cold resume, and one sample cannot establish availability for other Sessions.

**Treat an endpoint name or metadata version as schema compatibility.** The same name can acquire incompatible argument or result semantics. Domain API compatibility needs separate evidence.

## Consequences

Clients can explain unavailable operations without treating discovery as authorization. Capability snapshots may become stale immediately; ordinary calls remain authoritative. Missing context receivers remain a per-call result. The [Host identity](2026-09-15-host-connection-identity.md) and [portable connection](2026-09-15-portable-client-connections.md) decisions retain their independent identity, authorization and cancellation rationale; neither is superseded.
