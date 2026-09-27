# Agent Note: Disk-backed conversation workspaces

Status: implemented

## Problem

One separately mounted tmpfs per active workspace ties concurrency to provisioned RAM and mount inventory. Repository checkouts, build outputs, and development services can consume enough memory to constrain the number of concurrent agents even when the host has ample disk capacity.

## Decision

The workspace supervisor stores each conversation under an identity-derived directory in one configured owner-only disk root. The recovery root remains separate and retains bounded acknowledged checkpoints. `maxActiveWorkspaces` limits simultaneous runtimes independently of the number of retained conversations, so operators can size CPU and process pressure without preallocating storage mounts.

Workspace directories persist across container replacement, idle release, service restart, and ordinary shutdown. The supervisor validates the configured roots and every existing conversation directory as canonical, non-symlink, owner-only directories. A per-workspace lease prevents another supervisor from attaching writers to the same data. Unknown files without a valid ownership record reject instead of being replaced.

The existing settlement order remains authoritative: close new mutation admission, wait for or stop owned writers as required, create the bounded recovery artifact, update the durable manifest, then release execution capacity. Development VM disks and Docker named volumes remain Incus-managed durable storage with their own explicit quota.

## Alternatives considered

**Larger tmpfs mounts.** More RAM postpones the capacity limit but keeps repository and build data resident in memory.

**One disk directory per configured slot.** A fixed path list still requires provisioning one directory for every concurrency increment and couples retained workspace identity to reusable execution capacity.

**Delete idle workspaces after every checkpoint.** Rehydration adds avoidable I/O and makes ordinary resume depend on recovery-artifact reconstruction even when the durable checkout is healthy.

## Verification

Focused lifecycle tests cover capacity queuing, cancellation, persistent directory identity, unclean data retention, missing-directory recovery, failed checkpoint retention, and restart. The real Linux Loader scenario owns container isolation and disk persistence. The development VM acceptance scenario additionally owns Docker, Compose, browser, Git return, service continuity, and database recovery on the selected Incus host.

## Consequences

Disk capacity and I/O become deployment resources. Operators must place `storageRoot` on monitored durable storage and configure `maxActiveWorkspaces` for available CPU, memory, process, and VM capacity. Checkpoint byte and entry limits bound acknowledged artifacts but do not impose a filesystem quota on live build output. A full disk can leave a workspace pending; the supervisor retains its directory and refuses capacity release until recovery succeeds.
