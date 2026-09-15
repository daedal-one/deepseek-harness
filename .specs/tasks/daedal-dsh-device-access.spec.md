---
id: TASK:tasks/daedal-dsh-device-access
type: task
status: accepted
summary: "Add device enrollment and host discovery."
owners: [carlo]
progress: pending
addresses: ["REQ:frontend/daedal-dsh#c-device-access", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Add device enrollment and host discovery

## Plan

Add DSH-owned host identity, explicit capabilities, single-use enrollment and revocable device credentials. Adapt the existing companion host-assisted Tailscale discovery behavior at its DSH owner with bounded scans and separate candidate authorization. Preserve loopback listeners and existing service routes.

## Acceptance

Real iPhone QR pairing and host discovery succeed without address entry. Expired or replayed enrollment, revoked devices, mismatched host identity and unauthorized discovery fail explicitly. Candidate probes never receive another host credential and never imply enrollment.
