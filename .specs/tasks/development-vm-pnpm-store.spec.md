---
id: TASK:sandbox/development-vm-pnpm-store
type: task
status: accepted
summary: Provision a guest-ext4 pnpm store and Corepack for the shared development VM without purging existing dependencies.
owners: [carlo]
progress: in-progress
addresses: []
labels: [sandbox, workspace, tooling]
assignee: carlo
---

# Development VM pnpm store

## Scope

Provision the daedal-development VM with an ext4-backed pnpm store, machine-local pnpm configuration, and enabled Corepack shims. Keep `/home/carlo/.local/share/pnpm/store` as the configured store root because the shared workspace's existing `node_modules` records that path. Resolve it to `/var/cache/pnpm-store` inside the guest; do not purge dependencies or change the committed workspace pnpm configuration.

Retain provisioning in an operator-owned cloud-init template that can be applied to a fresh or rebuilt Ubuntu cloud VM without changing the pinned image, shared mounts, runtime provider, or unrelated work. Refuse conflicting store paths and non-ext4 cache storage. Never stop or rebuild the active shared VM to validate this fix.

## Acceptance

Verify idempotent provisioning, ext4 storage, SQLite WAL writes, the configured pnpm store path, and a frozen-lockfile install without a dependency purge. Reclaim only the unused shared `.pnpm-store/v11` after confirming that the guest and host no longer select it. Audit other SQLite-backed tooling; report workspace-local WAL databases separately rather than moving durable state or changing database journal modes without an explicit migration.

Distinguish source-template tests, persisted Incus configuration, live guest execution, and actual rebuild evidence. Preserve the unrelated daedal-subagent-model-selection changes.
