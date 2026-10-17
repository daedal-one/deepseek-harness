---
id: TASK:sandbox/shared-vm-workspace-capacity
type: task
status: accepted
summary: Decouple selected Workspace and Session counts from shared-VM hardware and execution capacity.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/environment-access#c-ownership
  - REQ:sandbox/environment-access#c-repositories
  - REQ:sandbox/environment-access#c-coordination
labels: [workspace, sandbox, lifecycle, scheduling]
assignee: carlo
---

# Shared VM Workspace capacity

## Acceptance

Selecting additional authorized Workspace directories does not consume one virtual PCI device per directory or fail because a fixed selected-mount count has been reached. The qualified sharing mechanism exposes only explicitly selected exact directories, preserves canonical source validation and stable guest paths, and keeps private Host directories, credentials, engine sockets, and neighboring unselected projects inaccessible. Storage exhaustion and invalid authority remain explicit failures; no implementation promises infinite physical storage or execution resources.

Existing Workspace registrations, Session identities, all committed Session generations, existing guest mappings, writable files, independently owned processes, and shared services remain intact. Adoption of the scalable mechanism preserves previously retained mounts. Selecting a Workspace does not restart Web or the VM, copy a repository, detach an active directory, or expand Git authority.

Logical Session creation, selection, durable pending input, and scheduling are independent of concurrent execution permits. Bounded execution capacity queues excess runnable work in arrival order and displays its waiting state. Cancellation removes only the caller's wait; admitted capacity is released only after its owned work settles. Child work must not deadlock behind a permit retained by its waiting parent. A restart retains pending messages and reconciles interrupted admission without duplicating execution or losing history.

Factory disposal aborts active execution while retaining unclaimed durable inbox messages. Explicit user cancellation keeps its existing discard behavior unless the caller requests inbox retention. Resume reconstructs retained input without making a model request by itself; the next normal wake consumes it through the ordinary admission path.

Operator adoption adds only one assessed catalogue device at approved service startup, preserves every existing device index and guest path, and reuses it on capable restarts. An empty catalogue can be removed for the assessed legacy runtime; retained alias records prohibit that downgrade. Qualification uses separate state and a disposable VM, and deployment binds installed helpers and configuration to the exact approved candidate. No preparation restarts production or mutates its device set.

Configured command capacity waits rather than rejecting an otherwise authorized operation solely because other commands are running. Disposal cancels and joins waiters and allocating commands before releasing resources. A cancelled allocation cannot release another command's permit, and unconfirmed cleanup cannot publish available capacity.

Evidence includes more selected directories than the existing VM's spare PCI ports, real shell/read/write/search operations in independently selected directories, unchanged directory authority and Git grants, concurrent selection, bounded execution with excess queued Sessions, waiter cancellation, parent/child progress, crash recovery, existing long-lived commands, retained mappings after restart, and every existing Session prefix. Focused tests, a real Loader composition, recorded-session output, both SDK projections, and actual Incus qualification distinguish implementation from deployment evidence.
