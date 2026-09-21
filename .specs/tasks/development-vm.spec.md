---
id: TASK:sandbox/development-vm
type: task
status: accepted
summary: Implement and verify opt-in conversation development VMs using Incus, guest Docker, and authenticated previews.
owners: [carlo]
progress: done
addresses:
  - REQ:sandbox/development-vm#c-world
  - REQ:sandbox/development-vm#c-docker
  - REQ:sandbox/development-vm#c-network
  - REQ:sandbox/development-vm#c-settle
  - REQ:sandbox/development-vm#c-recovery
  - REQ:sandbox/development-vm#c-browser
  - REQ:sandbox/development-vm#c-agent
  - REQ:sandbox/development-vm#c-evidence
labels: [sandbox, workspace, docker]
assignee: carlo
---

# Development VM

Implement the [development VM requirements](../sandbox/development-vm.spec.md) behind an explicit composition. Incus owns KVM lifecycle and durable guest storage. The existing Git workspace owner retains import, checkpoint, commit, and immutable branch-return authority. The rootless container provider remains independently supported.

## Delivery and evidence

Prove a real VM and Docker workload first, then connect ordinary tool providers, exclusive Git maintenance, durable recovery, and authenticated previews. Run focused failure tests, Loader composition, and the real-server acceptance flow before treating this task as complete. Keep production service and shipped profiles unchanged during isolated validation.

The isolated Linux acceptance flow passes with Incus 6.0, an Ubuntu 24.04 guest using kernel 7.0.0-31, guest Docker/Compose, Node 24, and Chromium. It verifies imported edits, Docker build and PostgreSQL, authenticated HTTP/WebSocket previews, terminal interaction, successful-turn service survival, immutable branch return, RAM-loss recovery with database contents, background work, and cancellation checkpoints. Unit and Loader tests cover failure admission and preview authentication; a keyless SDK Session snapshot records the failed-save diagnostic. Production profiles remain opt-in.
