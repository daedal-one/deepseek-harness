# pnpm storage in the development VM

## Summary

Use guest-ext4 storage for pnpm's SQLite-backed store when the development checkout is an Incus virtiofs share. The [cloud-init template](../../scripts/development-vm-pnpm.cloud-init.yaml) prepares the store location and Corepack shims without purging shared dependencies. This reference covers the template's prerequisites, verification, and other database locations that need separate attention.

## Table of Contents

- [Storage and provisioning](#storage-and-provisioning)
- [Verification](#verification)
- [Other SQLite tooling](#other-sqlite-tooling)
- [Dev Note](#dev-note)

## Storage and provisioning

The template targets the existing Ubuntu cloud development image with Node, Corepack, `findmnt`, and `node:sqlite` already available. Cloud-init installs a root-owned `/usr/local/sbin/dsh-provision-pnpm-store` and invokes it as guest root. The script accepts optional absolute store and cache paths; its defaults are `/home/carlo/.local/share/pnpm/store` and `/var/cache/pnpm-store`. It requires ext4 for the cache and probes SQLite WAL writes before enabling Corepack or setting machine-local pnpm configuration.

The configured store root matches the path recorded by the workspace's existing `node_modules`; pnpm adds its `v11` suffix. The symlink preserves that identity while placing the database on guest ext4. An existing correct symlink is retained. A different symlink or a real directory at the store path rejects provisioning and requires an explicit migration. Cached files are never deleted by the provisioner.

The script enables Corepack shims and uses pnpm 11.7.0 to set global `storeDir`, which writes the invoking user's `~/.config/pnpm/config.yaml`. Guest commands in this deployment run as root with `HOME=/root`; the `/home/carlo` store alias is a dependency-layout identity, not the guest execution account. The template changes neither the committed workspace configuration nor the pinned image, runtime provider, or shared mounts. [pnpm's store documentation](https://pnpm.io/settings/store#storedir) describes copying packages when the store and project cannot share hardlinks.

Retain the complete template in the operator's Incus provisioning configuration. [Incus 6 cloud-init support](https://linuxcontainers.org/incus/docs/stable-6.0/cloud-init/) depends on the image consuming the selected vendor-data key. A fresh root from a pristine cloud image normally runs the retained per-instance recipe after a rebuild; it does not retain cached store contents. User-data lists can override vendor-data `write_files` and `runcmd` lists, so changes to their composition require separate validation. Changing cloud-init configuration can replay other per-instance modules on the next boot. Do not clean cloud-init state or rebuild the active shared VM to test this repair.

## Verification

The focused template tests execute the extracted shell script with private temporary paths, actual SQLite WAL writes, and isolated Corepack/mount-check fixtures:

```sh
pnpm exec vitest run scripts/development-vm-pnpm.spec.ts
```

The tests cover repeated provisioning, cache retention, conflicting paths, relative-path rejection, non-ext4 rejection, and propagated Corepack failures. They do not establish cloud-init delivery, real Corepack configuration, or rebuild behavior.

The host and guest repository store queries return `/home/carlo/.local/share/pnpm/store/v11`:

```sh
pnpm store path
incus exec --project dsh-vm-verify dsh-c533cb44dc73b913f0a49eb85cb609f0 -- pnpm --dir /workspace/deepseek-harness store path
```

Live acceptance additionally requires cloud-init Final completion, an ext4 mount for the resolved store, working pnpm shims in noninteractive commands, matching `node_modules` store metadata, and a frozen-lockfile install without a purge or SQLite I/O error. Source tests alone do not satisfy those deployment checks. The [decision record](../../.agents/notes/implemented/process/2026-10-07-development-vm-pnpm-store.md) records the storage trade-off and verification limits.

## Other SQLite tooling

Keep WAL databases on guest-local storage; setting `mmap_size=0` does not remove SQLite's [WAL shared-memory requirement](https://sqlite.org/wal.html#implementation_of_shared_memory_for_the_wal_index). Do not share a live WAL database between host and guest.

| Tool | Workspace risk | Safe placement |
|---|---|---|
| Forge Intellect adherence | `.git/forge-intellect/adherence/ledger.sqlite` exists in this shared checkout and uses WAL. The pnpm fix does not relocate it. | A separately planned guest-local state location; preserve ledger, WAL, and blobs during any migration. |
| [Daedal memory](../../packages/memory/memory-sqlite/README.md) | A workspace-backed `DSH_HOME` or explicit memory path puts its WAL database on virtiofs. | An absolute guest-local home or memory path. |
| [Desktop development](../../apps/desktop/README.md) | The launcher places its Electron profile under `apps/desktop/.desktop-build/development/electron-user-data`; overriding `DSH_HOME` alone does not move it. Chromium database modes are not verified here. | Guest-local `.desktop-build` storage. |
| [Session search](../../packages/session-query/session-query-sqlite/README.md) and [SQLite storage](../../packages/storage/storage-sqlite/README.md) | Custom relative paths resolve inside the checkout; both providers default to WAL when selected. Shipped search is disabled and domain storage uses JSON. | Absolute guest-local database paths, or the providers' supported rollback-journal modes where appropriate. |
| Forge adapter, LSP, and SQLite tests | Explicit Forge state/cache paths or `TMPDIR` can redirect databases into the share. | Guest-local `/state`, home/cache, and `/tmp`; the default Forge Spec LSP cache is in-memory. |

## Dev Note

The template is prepared and its isolated tests pass. Saving it to the running instance and running a guest frozen install were denied by policy review, including permission retries; cloud-init delivery and a rebuild have not been tested. The existing guest workaround remains in place. The unused shared `.pnpm-store/v11` is removed after host and guest queries confirmed that neither selected it. The guest also exposes the Forge adherence database in the shared Git directory; no durable database state is migrated by this task.
