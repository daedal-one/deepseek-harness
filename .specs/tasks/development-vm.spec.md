---
id: TASK:sandbox/development-vm
type: task
status: accepted
summary: Implement and verify opt-in conversation development VMs using Incus, guest Docker, and authenticated previews.
owners: [carlo]
progress: completed
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

The implementation includes focused tests for project quota and dedicated global bridge and ACL verification, canonical provider identity, live image and owner checks, process authorization, failed barriers, checkpoint transaction boundaries, and preview authentication. The deployment-owned scenario passed on the reserved remote host with the pinned local image: Compose and PostgreSQL startup, Chromium, authenticated HTTP and WebSocket previews, terminal resize and foreground inspection, Git return while services remained live, durable-source loss and recovery, and host-network denial all passed. A keyless SDK Session snapshot records the failed-save diagnostic. Shipped profiles remain unchanged.
