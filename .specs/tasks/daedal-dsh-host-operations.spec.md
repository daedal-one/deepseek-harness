---
id: TASK:tasks/daedal-dsh-host-operations
type: task
status: accepted
summary: "Expose DSH development operations."
owners: [carlo]
progress: pending
addresses: ["REQ:frontend/daedal-dsh#c-host-operations"]
blocked_by: ["TASK:tasks/daedal-dsh-native-client"]
---

# Expose DSH development operations

## Plan

Inventory filesystem, repository, worktree, terminal, preview and artifact owners. Reuse existing workspace read controllers and add required mutation/control remotes through DSH services. Define permission, revision, output bounds, backpressure, process and lifetime ownership before connecting frontend controls.

## Acceptance

Authorized and denied operations, stale file revisions, terminal reconnect/resize/stop, repository action outcomes and preview isolation pass focused tests and real client flows. The frontend does not retain an independent host execution server for these functions.
