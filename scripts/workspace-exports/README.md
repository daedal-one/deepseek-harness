---
description: "Operator installation and recovery of exact-directory exports for a shared Incus VM."
kind: "reference"
---

# Shared VM directory exports

The root controller retains exact selected directories below one private virtiofs catalogue. Each directory consumes a namespace-local bind mount and one small durable record; it does not consume a VM PCI device. The Host catalogue contains only inaccessible placeholders. Disk space, kernel mount resources and execution capacity remain finite. The controller has no delete, unmount, arbitrary command, or arbitrary destination operation.

## Operator installation

The controller requires Linux on x86-64 or arm64, Python 3.12 or later with the distribution's PyYAML package, and the Linux `open_tree`, `mount_setattr`, `move_mount`, `pidfd_open` and `setns` interfaces. Install [controller.py](controller.py) and [adoption.py](adoption.py) below `/usr/local/libexec/dsh-workspace-exports/` and [the launcher](dsh-workspace-exports) as `/usr/local/sbin/dsh-workspace-exports`, owned by root and writable only by root. Install [the systemd unit](dsh-workspace-exports.service) and enable it as a requirement of `dsh-web.service`. Preparation validates durable sources and placeholders before the Harness starts; it neither starts nor restarts Incus.

Create a root-owned catalogue with mode `0755` and separate root-owned state and `state/records` directories with mode `0700`. Every ancestor of catalogue and state must be root-owned and forbid group/other writes. Keep them outside guest-mounted sources and selection roots. A separate service-owned `0700` directory holds the Harness writer lease. Root owns mount state; the Harness account cannot edit it.

Write `/etc/dsh-workspace-exports.json`, owned by root with mode `0600`:

```json
{
  "environmentId": "development",
  "uid": 1000,
  "portal": "/var/lib/dsh-workspace-exports/catalogue",
  "state": "/var/lib/dsh-workspace-exports/state",
  "roots": ["/srv/projects"],
  "reservedSources": ["/srv/dsh/workspace", "/srv/projects/retained"],
  "guestPath": "/workspace/projects",
  "virtiofsd": "/usr/libexec/virtiofsd",
  "processFile": "/var/lib/incus/devices/project_instance/virtio-fs.repository-4.pid",
  "sharePath": "/var/lib/incus/devices/project_instance/disk.repository--4.workspace-projects",
  "maxRecordBytes": 8192,
  "maxRequestBytes": 8192,
  "maxResponseBytes": 65536,
  "pageSize": 64
}
```

`roots` authorize strict descendants only. `reservedSources` lists every existing native source, preventing selection of its descendants or ancestors as a second export. Sources must be canonical directories without symlink components and must not reside on tmpfs. The byte and page bounds apply to individual operations and records, not total selected directory count.

Grant the configured account permission to execute only the zero-argument launcher through sudo, using a rule such as `carlo ALL=(root) NOPASSWD: /usr/local/sbin/dsh-workspace-exports ""`. Validate the installed rule with `visudo`. Service requests use bounded JSON on stdin; only root may run the launcher's `prepare` argument. The definition, controller, launcher, unit and sudo rule belong in the deployment controller's configuration fingerprint.

Run the unit's preparation command as root, then provision one ordinary Incus directory disk with the exact catalogue source and guest path. Configure that device in the shared runtime's `repositories` and supply `directoryExports` as described in the [runtime reference](../../packages/sandbox/local-container-runtime/README.md#shared-environment-vm). Do not configure recursive Host bind mounts or shared propagation: namespace-local exports avoid their Incus stop/start cleanup obligations. Existing per-directory devices remain at their original indices and guest paths; include their sources as static repositories and preserve their legacy manifest unchanged. Never detach them to make capacity available.

For an existing VM, the installed prerequisite reads `/etc/dsh-workspace-exports-adoption.json` with root ownership and mode `0600`. Its operator assessment names `deploymentDefinition`, the fixed `node` and `incus` executables, `project`, `instance`, `legacyRevision`, an explicit list of `capableRevisions`, bounded `timeoutSeconds` and `maxOutputBytes`, the complete existing `devices`, the new `deviceName` and exact `device`, and `identity`. Identity includes the observed name, type, architecture, project, profiles and ephemeral flag, plus stable expanded configuration under `config`; only volatile fields other than `volatile.base_image` and `volatile.uuid` may vary. Capture these observations from the verified VM. Qualification must exercise adoption, idempotent reuse, empty-catalogue backout and retained-alias downgrade refusal against a disposable VM.

The prerequisite reads the deployment definition's root-owned launcher override and accepts only assessed immutable revisions. Starting a capable release adds its single exact catalogue device after checking the full existing configuration. Starting the assessed legacy release removes that device only when no retained alias record exists. Unknown devices, changed resources or authority, unassessed releases and retained aliases on a legacy downgrade fail closed. `PartOf=dsh-web.service` makes the prerequisite run again on controller-owned restart and recovery. Installing or enabling it must not restart the maintained service. Include its assessment and every installed helper in the deployment fingerprint before qualification. After aliases exist, recovery requires a capable retained release or a new qualified repair; retain Sessions, sources, records and device configuration throughout recovery.

`processFile` is the exact root-owned Incus process descriptor for the catalogue device; `sharePath` is that descriptor's expected source argument. Derive both from the qualified device, including Incus path escaping. The controller pins the parent and worker with pidfds and checks the worker's executable, arguments, root ownership, original user namespace, private mount namespace and catalogue root identity. A detached source clone receives `nosuid`, `nodev` and private propagation before it moves into that pinned namespace. The worker's normal sandbox remains enabled. Guest processes receive no Host namespace or controller authority.

## Recovery and retention

One root-state lock serializes controller requests. A private per-source record persists canonical source identity and pending intent before attachment. The target starts as a root-owned mode `000` placeholder; guest readiness requires opening the attached source directory. Completion retains the same source identity and stable hashed guest path. Paginated listing restores every retained record without imposing a whole-manifest byte limit.

An interrupted request can leave pending intent or a completed retained mount. Retry reconciles the exact recorded source device/inode and mount identity. Replaced sources, unexpected mounts, changed storage ownership, symlinks or corrupt records stop recovery. An operator must inspect and reconcile those conditions; do not delete records, detach mounts or substitute an empty directory automatically. Workspace registration deletion retains its shared export.

Back up the root records, configuration, selected Host sources, Harness state and VM disk together. VM shutdown releases its export namespace. Startup restores all retained records after Incus device setup and before guest toolchain readiness; the live Harness also detects a changed export-worker generation and restores aliases before subsequent operations. Ordinary Harness shutdown releases its lease and commands while exports and shared services remain. Qualify real tools, exact-source rejection, interrupted intent, Harness reattachment and clean VM stop/start on the installed Incus and virtiofsd versions. A process rollback after new selections requires a runtime that understands the retained aliases and the exact catalogue device; an older direct-device runtime cannot restore those aliases automatically. Never restore an older Session backup over newer messages.
