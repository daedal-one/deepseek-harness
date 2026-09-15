---
id: TASK:tasks/daedal-dsh-device-access
type: task
status: accepted
summary: "Add device enrollment and host discovery."
owners: [carlo]
progress: in-progress
addresses: ["REQ:frontend/daedal-dsh#c-device-access", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Add device enrollment and host discovery

## Plan

Add DSH-owned host identity, explicit capabilities, single-use enrollment and revocable device credentials. Adapt the existing companion host-assisted Tailscale discovery behavior at its DSH owner with bounded scans and separate candidate authorization. Preserve loopback listeners and existing service routes.

Persist a random Host identity through the existing credential provider, independently of browser signing secrets, hostnames and network addresses. A new application root gets a distinct activation identity; reloading Connection within that root preserves it. Expose the identity through the authenticated, carrier-neutral Connection RPC with shared Client validation. Failed or malformed persistence must prevent a new identity from being published. Identity is a correlation fact, never proof of authorization or a complete API/capability handshake.

## Acceptance

Real iPhone QR pairing and host discovery succeed without address entry. Expired or replayed enrollment, revoked devices, mismatched host identity and unauthorized discovery fail explicitly. Candidate probes never receive another host credential and never imply enrollment.
