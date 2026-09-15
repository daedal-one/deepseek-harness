# Agent Note: Durable Host and application activation identity

Status: implemented

## Problem

A reconnecting native client can reach a different harness at a previously used address. Several application roots can also share a credential store. Neither a network address nor a browser login secret identifies which persisted Host and current activation answered a request.

## Decision

Connection owns a random durable Host UUID in the `client-connection/host-identity` grant record and a separate random activation UUID per application root. The credential provider's serialized mutation establishes one persisted identity before Connection publishes its service. Invalid or failed persistence prevents activation. A Connection reload retains its root's activation and refuses a removed or replaced Host record. Copying a credential store copies its identity; this mechanism does not identify physical hardware.

The authenticated `connection/identity` RPC returns a versioned identity envelope through the existing carrier. Shared Client validation refuses malformed responses. Identity remains a correlation fact: it neither grants authority nor proves that another socket reached the same activation. Envelope version is independent of API and Session compatibility.

[Browser authentication](2026-08-24-browser-token-authentication.md) continues to own login and request authorization. [Portable connections](2026-09-15-portable-client-connections.md) continue to own transport generations and recovery. Both notes retain independent rationale; this decision supersedes neither.

## Alternatives considered

**Derive identity from the address or hostname.** Addresses change and can be reassigned; several harnesses can share a machine.

**Reuse a browser signing secret or telemetry identifier.** Authentication rotation must not rename the Host, and telemetry's best-effort persistence cannot establish the required identity lifetime.

**Generate a new id whenever persistence fails.** A storage problem would silently publish an apparent new Host and hide the loss of continuity from paired clients.

## Consequences

Clients can distinguish a known store from a new application activation without receiving a secret. The identity record becomes part of Host backup and cloning semantics. Authentication, permission policy, API negotiation and binding identity to an active stream require their own checks; this response alone does not establish native device pairing.
