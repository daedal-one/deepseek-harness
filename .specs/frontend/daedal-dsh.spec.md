---
id: REQ:frontend/daedal-dsh
type: requirement
status: accepted
summary: "Provide DSH-owned capabilities for the primary Daedal desktop, mobile and web interface."
owners: [carlo]
level: MUST
---

# Daedal DSH native frontend integration

## Scope

Daedal DSH is the approved primary frontend migration in the daedal-one Paseo fork. The frontend repository owns its product specification tree and migration plan; this requirement owns the DSH backend behavior it needs. The existing DSH UI remains available during migration.

:::{requirement id="daedal-dsh" level="MUST"}
- {#c-native-client} DSH MUST provide a supported portable client face for native mobile, browser and Electron consumers, preserving host-qualified native session/workspace identity, event ordering, paging, deferred detail, control streams, interaction lifecycle and compatibility refusal semantics. Mutation outcomes MUST distinguish success, rejection and uncertainty; retries MUST use deduplication or explicit reconciliation rather than blind resubmission.
- {#c-device-access} DSH MUST own stable host identity, capability discovery, short-lived single-use device enrollment, revocable scoped access and bounded host-assisted Tailscale discovery. Candidate discovery MUST NOT confer access or forward existing credentials. Device credentials MUST NOT be exposed through permanent QR codes, URLs, diagnostics or provider-secret responses.
- {#c-host-operations} File mutations, repository/worktree operations, terminals, previews and artifacts required by the frontend MUST resolve through their DSH owners, with permission, revision, bounds, process and lifecycle semantics. The read-only workspace API MUST NOT be treated as a file mutation API.
- {#c-configuration} Host-supported model, provider, preset, settings, credential, plugin, skill and memory/context management MUST use their DSH authorities. Credentials MUST remain redacted to clients; conflicts and unavailable capabilities MUST be explicit. Privileged plugin transactions MUST NOT become arbitrary renderer package execution.
- {#c-workflows} Plans, goals, jobs, workflows and schedules MUST retain DSH ownership and durable state. Required management operations MUST be exposed by the configured owning capability; read-only inventory MUST NOT imply mutation support. The frontend MUST NOT supply an independent scheduler or goal loop.
- {#c-desktop} Managed Daedal desktop execution MUST reuse DSH DesktopHost, bundled upstream Node, reserved-profile ownership, installation locks, health checks and compatible recovery. It MUST NOT start a competing writer to an owned store. Closing a client attached to an external DSH host MUST NOT terminate that host. Supported application entry rules and committed Session generations MUST remain intact.
:::

## Sources

- [Connection](spec:src:packages/client/connection/src/client/connection.ts)
- [Native remotes](spec:src:packages/api/remotes/src/client/index.ts)
- [Session controller](spec:src:packages/api/session-controller/src/index.ts)
- [Workspace files](spec:src:packages/api/workspace-files/src/index.ts)
- [Desktop runtime](spec:src:apps/desktop/src/main.ts)

## Verification

The addressed TASKs own focused unit, artifact, lifecycle and recorded-session evidence. The frontend migration also requires real Mac/iPhone/browser flows, concurrent interaction resolution, interrupted operations, credential revocation, long histories and installation recovery. Accepted intent does not establish implementation adherence.
