# Agent Note: Share a persistent VM workspace across conversations

Status: implemented

## Problem

Per-conversation Git import, checkpoint capture, and automatic return make repository size and turn completion depend on transport limits and multi-stage recovery. These operations prevent usable remote development even when the host has durable disk capacity. The user requires sessions to collaborate in the same environment rather than independent copied repositories.

## Decision

The optional shared runtime attaches one environment to one persistent Incus VM and an explicit set of disk-backed directory mounts. Sessions share those files and ordinary Git state. The guest command transport and filesystem/subprocess providers operate independently of conversation settlement. A turn ending does not copy files, commit changes, freeze the VM, or publish result refs. Automatic commits are outside this composition.

The [accepted task](../../../../.specs/tasks/shared-environment-workspace.spec.md) owns the delivery and verification requirements. The [conversation workspace decision](../../implemented/architecture/2026-09-20-conversation-git-workspace.md) and [development VM decision](../../implemented/architecture/2026-09-21-conversation-development-vm.md) retain their historical-data and explicitly selected legacy-composition obligations; they are not fully superseded while those consumers remain. The remote composition stops selecting the Git transaction lifecycle. Existing recovery data is preserved, not interpreted as permission to overwrite shared files.

## Alternatives considered

**Increase checkpoint bounds and stream every transaction.** Streaming reduces memory pressure but retains import, save, publication, retry, and recovery obligations that the shared-directory workflow does not need.

**Share directories through per-command containers.** This shares files but not installed guest tools, services, and the environment lifetime requested by the user. The existing Incus setup already supplies the required VM boundary.

**Create a worktree for every session.** This restores per-session divergence and reconciliation. A single operator-prepared worktree per repository can be mounted if desired, but the harness must not manufacture per-session Git state. Worktree metadata paths must be reachable through explicitly authorized mounts.

## Verification

Real-provider tests on the existing server verify that independent contexts see the same mounted files, cancellation leaves the other context's command running, and disposal permits reattachment to the same VM and files. Unit tests reject missing instances, mount drift, RAM-backed source directories, and excess commands. Attachment closure waits for the owned guest unit's cleanup; unavailable cleanup reports an error instead of claiming removal. The [qualification record](../../../../packages/sandbox/local-container-runtime/tests/shared-vm-qualification.md) separates these observations from activation and remaining UI acceptance.

## Consequences

Agents can conflict on the same files, index, branch, or Git lock. Sharing is intentional, not an isolation guarantee between sessions. All agents in an environment must belong to the same trust domain. Mounted repository writes are immediate; automatic provenance, immutable per-turn recovery generations, and host-worktree protection are not promised. Existing retained conversation work needs explicit reconciliation, and no migration may overwrite it silently.
