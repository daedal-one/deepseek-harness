# Agent Note: Separate selected directories and Session inventory from execution capacity

Status: implemented

## Problem

A virtual PCI device per selected Workspace makes directory admission depend on a VM's finite hot-plug slots. Applying that limit to Session creation also confuses retained identity with active resource ownership. Rejecting tools under command pressure loses useful progress, and clearing unclaimed inbox input during shutdown loses queued requests.

## Decision

The shared runtime's optional `directoryExports` provider uses one ordinary operator-provisioned virtiofs catalogue. A root-owned controller validates exact eligible sources, pins path components without symlinks, persists per-source intent and identity, and attaches detached private bind mounts inside the catalogue's existing virtiofsd sandbox namespace. Pidfds, the root-owned Incus descriptor, executable and argument checks, namespace ownership, and matching sandbox-root identity pin the authorized worker. The Host catalogue contains only root-owned inaccessible placeholders. Namespace shutdown releases its mounts without leaving nested Incus device mounts that block restart. Private records and paginated discovery separate total retained directories from individual request bounds. The [operator reference](../../../../scripts/workspace-exports/README.md) owns installation, qualification and recovery.

Retained native devices preserve existing guest mappings. The direct-device provider and its [selection preparation policy](../bug-fix/2026-10-15-workspace-selection-mounts.md) remain available for bounded deployments. Both providers finish preparation before Workspace or Session publication. Git grants remain independent of selection.

An operator-owned service prerequisite adopts only the assessed catalogue device when an approved capable release starts. It checks the existing VM identity and complete device set, reuses the catalogue on capable restarts, and permits legacy backout only before any alias record exists. Retained aliases require a capable recovery release; they are never deleted to make a downgrade start. Live operations detect a replaced export worker and restore retained aliases before using their stable paths.

Optional `maxActiveConversations` bounds admitted root turns in arrival order. Children share and retain their root reservation, allowing a parent to await child progress while unrelated roots wait. Existing durable `workspace/admission` events expose waiting, admission and cancellation without a Session-format change. `maxLiveProcesses` separately queues command attachments; only confirmed removal releases capacity. Cancellation withdraws its own waiter, and shutdown cancels and joins waiters and allocations before releasing runtime resources.

Factory disposal preserves unclaimed durable inbox messages while aborting active work. Resume reconstructs input for the next ordinary wake and cancels orphaned waiting admission records. Explicit user cancellation retains its existing discard semantics. This distinction keeps service maintenance from silently discarding work while avoiding an unsolicited model request on resume.

## Alternatives considered

**Mount a broad projects parent.** This admits neighboring projects before selection and exposes contents outside the chosen exact directories.

**Increase the per-directory cap or reboot to add ports.** Hardware still imposes a finite count, and each reboot interrupts shared services.

**Evict old mounts when capacity is occupied.** Existing Sessions and services retain references to those paths; inactivity is not permission to detach their files.

**Queue every child behind independent turn capacity.** A parent holding the last permit can await a child that cannot be admitted. Root-owned reservations avoid that deadlock while command capacity remains bounded.

## Consequences

Workspace and Session counts have no fixed runtime admission cap; retained records, files, kernel mounts and process memory still consume finite resources. Selection can fail explicitly on authority, storage, source identity or mount errors. Exports remain environment-owned until explicit operator reconciliation. Active root turns and command attachments have separate configurable bounds, and unconfirmed command cleanup withholds capacity for operator recovery. Pending messages survive restart; resuming a Session alone does not execute them or restart a previously interrupted turn.
