---
id: TASK:sandbox/shared-environment-workspace
type: task
status: accepted
summary: Replace remote conversation Git transactions with one persistent Incus VM and shared disk mounts per environment.
owners: [carlo]
progress: in-progress
addresses: []
labels: [sandbox, workspace, simplification]
assignee: carlo
---

# Shared environment workspace

## Scope

The remote deployment uses one persistent Incus VM per configured environment. All sessions and agents admitted to that environment share its repository directories, installed tools, running services, and Git state. Repository files remain on durable host disk and are mounted into the guest; repository size is not bounded by guest RAM or a checkpoint serializer. Reuse the existing Incus image, storage, bridge, ACL, process transport, and provider adapters where their behavior meets this task.

This replaces the remote deployment's per-conversation import, mutation lease, finalization, checkpoint, branch-return, provenance, and automatic commit workflow. The former conversation Git requirement remains applicable only to explicitly retained legacy compositions and historical data. Do not introduce another save/retry transaction to emulate shared files. Periodic commits are deferred; normal Git commands remain available.

## Requirements

- Configure the environment identity and exact host-directory to guest-directory mounts explicitly. Reject duplicate, overlapping, relative, missing, or non-directory mount sources and guest targets outside the workspace. Never mount the host root, control sockets, credentials, or a broader parent directory to make a repository path convenient.
- Verify the retained VM's identity, image, CPU/RAM/root-disk settings, network, and exact mounts before use. Mount changes require an explicit stopped-instance reconfiguration; never silently replace a missing or differently configured retained VM.
- Keep the VM and its disks across conversation close and Harness restart. Closing one session or cancelling one command must not stop other sessions, the VM, or unrelated services. Terminate and observe only owned command units. Ordinary turn completion performs no Git or whole-workspace filesystem operation.
- Every filesystem, shell, terminal, instruction, and workspace-view request uses the same environment and path mapping. Unknown host paths fail rather than selecting another repository. Do not grant host execution as a fallback.
- Preserve existing conversation directories, checkpoints, and Session logs during transition. Do not merge divergent retained work into a shared checkout automatically. Expose the retained work's location and require an explicit choice before overwriting or reconciling files.
- Show actionable unavailable, configuration, and command failures without endless admission or save retries. Do not display a shared mount as waiting for the removed save workflow.

## Acceptance

Record unit, Loader, real Incus, and UI evidence. Verify two concurrent sessions see the same edits and repository state; cancelling one command leaves the other running; files larger than 512 MiB survive process and Harness restart with matching hashes; installed guest tools and services persist; no per-turn Git mutation or archive capture occurs; only configured mounts are visible; and malformed or changed VM configuration refuses admission. Qualify the actual existing server before activation, preserve rollback data, and distinguish source implementation from deployed behavior.
