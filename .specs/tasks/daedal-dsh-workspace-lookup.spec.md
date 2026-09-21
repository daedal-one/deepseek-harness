---
id: TASK:tasks/daedal-dsh-workspace-lookup
type: task
status: accepted
summary: "Expose a read-only Host Workspace lookup for native registration recovery."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-client-create-profile"]
---

# Shared Workspace lookup

## Plan

Expose the existing Host registry path resolution through an optional generated Workspace read and the portable Client facade. Only the Host canonicalizes paths. Return the current registered Workspace or explicit absence without creating, updating, deleting, replaying a mutation or merging a lookup reply into the followed Client list. Forward caller cancellation through the generated carrier. Failures remain failures, never absence.

A positive lookup reports the current registration at the resolved Host path, not a receipt for an earlier request. Symlinks may change and deleted paths can be registered with another identity. Absence cannot establish that an uncertain request was rejected. Native registration must retain that distinction and never automatically resend. Existing creation and follow endpoint requirements remain unchanged; older Hosts simply do not advertise the new optional read.

Registry lookup must exclude provisional entities from unfinished create writes. Qualify positive, absent, alias, invalid-path, pending-write and rollback cases at the shared owner. No new durable format or Session event is required.

## Acceptance

Focused registry, Host, Client and test-runtime owners cover lookup without mutations, no list resurrection or stale replacement, error propagation and signal forwarding. Negative controls prove provisional entities and lookup-driven list mutation are rejected. A compiled portable Client against an isolated built Host resolves an accepted registration after a lost create reply using reads alone, observes canonical aliases, distinguishes absence and failures, and observes a fresh identity after explicit deletion and registration. Restart the isolated Host to verify durable identity. Client disposal leaves the external Host alive. Build, types, lint, documentation and portable artifact checks pass before committing. Native storage, capability admission, registration UI and phase publication remain separate work.

## Sources

- [Registry](spec:src:packages/workspace/workspace/src/index.ts)
- [Host commands](spec:src:packages/api/workspace-controller/src/commands.ts)
- [Client model](spec:src:packages/api/workspace-controller/src/client/model.ts)
- [Client facade](spec:src:packages/api/workspace-controller/src/client/service.ts)

## Qualification

The eight selected registry, Host, Client and test-runtime owners pass 139 cases. The seven measured runtime modules have 100% statement, branch, function and line coverage. Two negative controls fail when provisional registry entities become visible or successful lookup replies are merged into the followed list. The normal full build, Host and Client types, full lint, 32 documentation checks, 16 hygiene checks and two portable artifact cases pass.

A compiled portable Client enrolled against an isolated built Host, lost an accepted create reply, and resolved the same canonical Workspace with reads alone. Exactly one create was dispatched for that attempt; its identity survived Host restart. Retargeting its symlink returned absence for the new unregistered target while the original registration remained. Explicit deletion and registration produced a fresh identity. Missing and relative paths remained structured errors, a held carrier request honored cancellation, and Client disposal left the external Host alive. Owned Hosts were stopped and joined and private state removed. No model request or live Session mutation was issued.

Twelve existing core, history, Session creation and Workspace creation endpoint descriptors match the delivered TestFlight 7003007 archive and installed f9 Client. The new lookup is separately advertised; neither older Client contains its generated admission metadata. This is runtime and artifact evidence, not native registration UI or full release acceptance. Evidence is `.dev/daedal-dsh-plan-audit/workspace-lookup-20260921/verification.json`. The application remains pinned to f9; native registration persistence, explicit current-state presentation, optional admission and real browser/Electron gestures remain next work.
