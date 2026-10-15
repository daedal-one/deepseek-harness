---
id: TASK:tasks/workspace-selection-mounts
type: task
status: accepted
summary: Prepare and verify selected Workspace mounts before registration or Session creation.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/environment-access#c-repositories
  - REQ:frontend/daedal-dsh#c-native-client
labels: [workspace, sandbox, lifecycle]
assignee: carlo
---

# Workspace selection mounts

## Acceptance

Workspace registration and Session creation await execution preparation for the selected canonical directory. The shared-VM provider reuses an existing mount or attaches the exact selected directory below an operator-approved selection root. Selection never mounts that root, exposes credentials or engine sockets, changes Git authorization, or falls back to Host execution. Deployments without selection roots reject unavailable directories before creating a registration or Session, with an actionable error. Host and legacy private-workspace compositions retain their execution policies.

The Workspace picker re-admits an eligible existing blank Session through idempotent Session creation before opening it. Reuse preserves its identity, model and permission choices, transcript, and Workspace membership, and concurrent choices share one request. A failed re-admission leaves the previous selection intact and never manufactures a replacement Session.

Selected mounts have stable guest paths and a bounded, owner-only durable manifest outside all guest-visible mounts. One process holds the manifest lease. Mount intent is durable before VM mutation; readiness and the final manifest commit precede successful selection. Interrupted attachment is recovered against the retained VM's exact device identity. Unknown devices, changed sources, invalid manifests, overlapping mounts, or unconfirmed cleanup fail closed. Concurrent selections serialize, and a repeated selection reuses its mount.

Attachment does not restart Web or the VM, terminate existing commands, alter existing mounts, copy repositories, mutate Git, or delete Session data. Restart restores the same selected mounts and path mapping. Caller cancellation may leave committed attachment intent and requires reconciliation rather than blind replay; disposal waits for owned attachment work before releasing the manifest lease. Read-only Workspace lookup never attaches a directory.

Focused tests cover registration and Session rejection before writes, aliases, concurrent and repeated selection, durable restart, interrupted attachment, malformed state, denied roots, mount failures, disposal, and unchanged existing operations. Loader and recorded-session coverage verify ordinary tools use the selected mapping. Real Incus qualification covers live attachment, tool access, retained commands, restart, and preserved histories before deployment.
