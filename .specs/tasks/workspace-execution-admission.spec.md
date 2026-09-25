---
id: TASK:sandbox/workspace-execution-admission
type: task
status: accepted
summary: Separate conversation creation from bounded, queued execution workspace admission.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/conversation-git-workspace#c-admission
  - REQ:sandbox/conversation-git-workspace#c-ownership
  - REQ:sandbox/conversation-git-workspace#c-storage
  - REQ:sandbox/conversation-git-workspace#c-recovery
labels: [sandbox, workspace, web, lifecycle]
assignee: carlo
---

# Queued workspace execution

## Acceptance

Conversation creation and selection complete without allocating a container workspace. Submitted work waits for bounded execution capacity while retaining its independent workspace identity, files, prompt, and cancellation. Idle conversations release physical slots only after their owned writers and checkpoint settle. A later turn restores the same conversation's acknowledged files before model execution. Child agents share their parent's admitted workspace; unrelated conversations never share mutable checkouts.

Browser evidence covers retained selection, visible waiting, cancellation of a waiter, automatic admission after capacity becomes available, and reopening a completed conversation. Deterministic tests cover more conversations than slots, FIFO order, overlapping admission, cancellation, teardown, failed checkpoint retention, and separate files across slot reuse. Session-driven snapshots and both SDK projections cover persisted admission state.
