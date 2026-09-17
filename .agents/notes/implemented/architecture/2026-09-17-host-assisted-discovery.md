# Agent Note: Host-assisted discovery

Status: implemented

## Problem

A phone cannot rely on a local Tailscale CLI or a complete peer inventory to find other DSH Hosts. The Host it already trusts can find candidates, but discovery metadata must not become authority to transfer that Host's credentials.

## Decision

[Connection](../../../../packages/client/connection/README.md#host-discovery) owns an optional authenticated discovery operation and an exact public advertisement. The advertisement contains only bounded correlation metadata, behind the existing Host/Origin fence. Scan targets come from bounded local Tailscale status and deployment-owned ports, never from the caller or a returned URL. Numeric-address validation, direct HTTP dispatch, refused redirects, omitted credentials and bounded response bytes prevent a candidate from redirecting a privileged probe.

The status command runs on the physical Host with the canonical scrubbed environment. Connection retains the subprocess package as a peer so the scrubber observes the provider's shared proxy-policy state; it is not classified as safe to duplicate. The configured subprocess capability can execute in another execution world, so it cannot establish this Host's tailnet membership. The configured executable is the actual Tailscale binary; no shell, arbitrary arguments or descendant-spawning wrappers are supported. Cancellation kills that owned process and awaits close. One scan owns its network work; callers cancel independently, and a replacement waits for cancelled work to finish.

## Alternatives considered

**Scan directly on each phone.** Mobile platforms do not expose the desktop CLI or its authenticated tailnet inventory.

**Trust tailnet membership or an advertised Host id as enrollment.** Neither proves that the peer is the intended credential owner. Each Host keeps its own owner-authorized device enrollment.

**Forward the assisting Host's credential during discovery.** An unrelated peer would receive a reusable credential for another Host. Discovery requests are anonymous and enrollment remains separate.

## Consequences

Portable clients consume one validated, versioned response without duplicating discovery protocols. Missing discovery support cannot block ordinary Session access. Coalescing and caching bound repeated authenticated scans; truncation and fixed failure states prevent an empty list from claiming complete network knowledge. The [device enrollment decision](2026-09-16-device-enrollment-and-revocation.md) continues to own grants and revocation. Controlled status and HTTP fixtures prove request bounds, cancellation and authorization; actual tailnet reachability and physical-camera acceptance remain separate qualification.
