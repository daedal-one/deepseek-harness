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

Bind Host identity to the authenticated Gateway event stream before publishing a native connection generation. The portable Remote installer requires the paired Host id, refuses a missing or different identity and an unsupported Gateway opening protocol, and keeps generated domain calls and streams unavailable until that Host is ready. Lost generations cancel active native operations and refuse late results without replaying mutations. New activations of the same paired Host may reconnect. Browser and private DesktopHost carriers retain their existing authorization. Gateway opening protocol version is separate from Session data and domain API compatibility.

Expose an authenticated Gateway capability snapshot from current Host descriptors and dispatch prerequisites. Advertise only fully strict descriptors, never Client-compiled selection or SRC inference. Distinguish direct availability, a required receiver Context and missing dispatch prerequisites without invoking resolvers or business methods. The snapshot contains endpoint names, unary/stream modes and fixed reason codes, excludes local paths and provider credentials, and is bound to the current Host and activation. A portable reader validates the entire versioned response, refuses another Host or activation, forwards caller cancellation and never retries. Capability metadata is advisory and does not establish domain schema compatibility, authorization or successful resolution of a particular Session. Calls continue to enforce live Host checks.

## Acceptance

Real iPhone QR pairing and host discovery succeed without address entry. Expired or replayed enrollment, revoked devices, mismatched host identity and unauthorized discovery fail explicitly. Candidate probes never receive another host credential and never imply enrollment.
