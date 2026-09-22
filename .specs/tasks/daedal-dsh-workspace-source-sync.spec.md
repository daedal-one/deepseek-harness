---
id: TASK:tasks/daedal-dsh-workspace-source-sync
type: task
status: accepted
summary: "Integrate published conversation workspace and Web changes with native history owners."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-history-view-lifetime"]
---

# Published workspace integration

## Plan

Merge the published automatic conversation Git workspace and Daedal Web presentation into the migration branch, preserving the shared Session paging, retained-detail and caller-cancellation changes. Keep conversation Git workspaces opt-in and preserve the shipped profile selections. Inspect lifecycle, Session event, shared Chat, file-access and SDK changes before native creation uses these owners.

## Acceptance

Qualify the combined lifecycle, workspace consumers, shared native history and current Web presentation with selected owner tests, both SDK projections, the workspace-outcomes recorded Session, built Host checks and installed native Client compatibility. Required workspace events remain required: older Clients must refuse affected Sessions rather than omit those outcomes. Record compatibility limits separately from ordinary Session acceptance. Full Phase 4 publication and deployment remain gated by their complete acceptance; this source integration changes no running service or installed application.

## Sources

- [Conversation workspace intent](spec:sandbox/conversation-git-workspace)
- [Native Client interface](spec:frontend/daedal-dsh-client)
- [Shared Session](spec:src:packages/api/session-controller/src/client/sessions/session.ts)
- [Workspace outcomes](spec:src:packages/sandbox/local-container-runtime/src/workspace-types.ts)

## Qualification

The combined source passes 607 selected owner cases in 30 files, full build and Client typecheck, lint, all 32 documentation and 16 hygiene checks, and both portable Conversation/Chat artifact cases. The portable Chat artifact carries pending and returned workspace receipts through the same keyed source outside a browser. The workspace-outcomes recorded Session and both TypeScript and Python SDK projections pass. Six actual Chromium cases cover workspace receipts, the user-opened fork overview and independent credential onboarding; four real companion replay cases pass against an isolated built Host.

The installed native Client pinned to `a6bef716` reads ordinary and 10,000-event Sessions from the merged Host, retaining page retry, caller cancellation, coalescing and bounded exact details. All nine required/history endpoint descriptors match the delivered TestFlight 7003007 archive. That Client explicitly refuses the new required `workspace/state` event before publishing the affected Session. Conversation Git workspaces remain opt-in; native workspace-outcome presentation and a newly qualified portable distribution remain prerequisites to enabling this capability for the companion.

Evidence is recorded in `.dev/daedal-dsh-plan-audit/workspace-source-sync-20260921/verification.json`. Real Linux Podman execution, physical iPhone checks and full Phase 4 release acceptance are not established by this Mac integration check. No service activation, source publication, installed-app replacement or TestFlight upload belongs to this increment.
