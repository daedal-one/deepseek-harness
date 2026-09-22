# Agent Note: Workspace Registration Lookup

Status: implemented

## Problem

Registration accepts a Host path rather than a caller-owned request identity. A client that loses the create reply cannot learn the current canonical registration by comparing its input spelling with streamed paths: symlinks and platform path rules belong to the Host. Calling create again is another mutation, even when path deduplication usually returns an existing record.

## Decision

The Workspace registry resolves only entries in its committed order. Internal entities staged before registration writes finish are not lookup results. The generated `workspace.resolveByPath` read exposes this owner operation to the shared portable Client without writing files, changing registration or replaying create. Lookup failure stays distinct from a successful absent result. Caller cancellation reaches the generated carrier.

The Client returns the lookup result without merging it into the followed list. Follow generations and mutation echoes own that projection; a delayed read is not permission to resurrect a deleted registration or replace newer state.

## Alternatives considered

A local path comparison would duplicate Host canonicalization and misread aliases. Retrying create would conflate checking state with changing it. A lookup result cannot be a prior-request receipt because a symlink can be retargeted and a deleted path can be registered with a fresh identity. Consumers may present the current registration and use its identity explicitly, but must retain uncertainty about the original attempt. An absent read does not prove rejection.

## Verification

Owner tests hold a registration write, read before commitment and then release or fail it. Host tests cover canonical aliases, no-write absence, errors and replacement identity. Client tests retain the followed snapshot across successful and delayed reads and forward cancellation and structured failures. The built Host probe loses an accepted create reply, resolves with reads alone and verifies durable identity after restart.

## Consequences

Native registration needs its own persisted attempt and current-state presentation; this read does not supply request deduplication or automatic mutation recovery. The existing [registration deletion decision](../feature/2026-07-27-workspace-registration-deletion.md) remains authoritative for metadata-only deletion and fresh identities. Its ownership and recovery rationale is retained, not superseded.
