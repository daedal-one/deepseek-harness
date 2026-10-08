# Agent Note: Guest-ext4 pnpm storage for virtiofs development workspaces

Status: implemented

## Problem

The Incus development VM exposes its checkout through virtiofs. pnpm 11's store index uses SQLite WAL, which fails on this deployment's share with `ERR_SQLITE_ERROR disk I/O error`. The incident probe succeeds on guest ext4 and with a rollback journal on virtiofs; disabling main-database mmap does not make WAL work. A workspace-local store also consumes scarce host disk capacity. The shared `node_modules` records a host-path store identity that pnpm requires when reusing installed dependencies.

## Decision

The [cloud-init template](../../../../scripts/development-vm-pnpm.cloud-init.yaml) provisions `/var/cache/pnpm-store` on guest ext4 and preserves `/home/carlo/.local/share/pnpm/store` through a symlink. It verifies ext4 and SQLite WAL writes, refuses conflicting existing paths, enables Corepack shims, and uses pinned pnpm 11.7.0 to write machine-local global `storeDir`. The configured root excludes `v11`; pnpm appends its store generation. The invoking guest root owns `/root/.config/pnpm/config.yaml`; the host-shaped store path exists only to preserve dependency-layout compatibility.

The recipe is operator-owned provisioning, not runtime-provider behavior or committed workspace pnpm configuration. A pristine cloud-image root and successful cloud-init delivery are prerequisites for replay after rebuild. Existing instance provisioning must preserve other cloud-init configuration; user-data list overrides and image-specific key consumption require deployment verification. Setting cloud-init keys can replay other per-instance setup on a subsequent boot. The task never stops or rebuilds the active shared VM.

The [development VM decision](../architecture/2026-09-21-conversation-development-vm.md) independently owns VM execution and isolation; this storage recipe does not supersede it. The [storage reference](../../../../docs/cookbook/development-vm-pnpm-store.md) owns verification and other SQLite-tooling risks.

## Alternatives considered

**Move the workspace to ext4.** This removes the filesystem limitation for all databases but changes shared-source ownership and deployment storage. The pnpm repair does not require that broader change.

**Configure `/var/cache/pnpm-store` directly.** This gives pnpm a different store identity from the shared dependency tree and requires a purge and full reinstall. Keeping the existing identity avoids that disruption.

**Use a workspace setting, environment variable, or npm rc file.** A committed workspace setting imposes one deployment's path on all contributors. The incident established that the tested rc and environment settings are ignored by pnpm 11.7.0; its machine-local YAML setting works.

**Force rollback journals or disable mmap.** pnpm owns its WAL store implementation. The incident's `mmap_size=0` probe still fails; changing that pragma is not a fix for the WAL shared-memory requirement.

## Verification

The [focused tests](../../../../scripts/development-vm-pnpm.spec.ts) execute the template's extracted script with private temporary paths and actual SQLite WAL writes. They verify repeatability, cached-data retention, wrong-link and real-directory rejection, relative-path rejection, non-ext4 rejection, and Corepack failure propagation. Mount detection and Corepack side effects are fixture-controlled; these tests do not prove real cloud-init delivery or global configuration persistence.

Host and guest repository queries select `/home/carlo/.local/share/pnpm/store/v11`, matching the shared dependency metadata. Guest mount inspection identifies `/var/cache/pnpm-store` as ext4 and the workspace as virtiofs. The unused shared `.pnpm-store/v11` is removed. The handoff records a successful guest install with the transient workaround; the attempted frozen-install recheck and Incus template persistence are denied by policy review, including permission retries. The recipe is prepared but not deployed, and no rebuild validation is claimed.

## Consequences

Dependency reuse keeps its expected store identity; package imports crossing from ext4 to virtiofs may copy rather than hardlink. The guest root disk owns cache capacity, and rebuild loses cached content while provisioning reestablishes its location. A conflicting path requires an explicit migration rather than implicit deletion.

The pnpm repair does not fix other shared WAL databases. Forge Intellect adherence exists under the shared `.git/forge-intellect/adherence`; it needs a separately planned guest-local state location, preserving the ledger, WAL, and blobs. Memory, desktop profiles, custom SQLite backends, and configured caches also need guest-local paths. Durable database migration is outside this recipe.
