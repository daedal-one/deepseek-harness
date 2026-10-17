# Agent Note: Prepare selected Workspace execution before publication

Status: implemented

## Problem

A valid Host directory can be registered as a Workspace while the shared VM has no matching mount. Sessions then accept that directory as their cwd, and every filesystem or shell operation fails before execution. Increasing Session permissions cannot supply an absent execution-world mount.

## Decision

Workspace registration and Session creation await the serial `workspace/prepare` event before their first registration or Session write. The shared runtime reuses existing mappings or attaches the exact selected directory under an operator-configured parent root. Other execution compositions retain their own preparation policy. Read-only lookup does not request attachment, and a failed preparation is a definite rejection of this registration attempt rather than an uncertain registry write.

The Client re-admits a reusable blank Session through the existing idempotent Session-create operation. Keeping its identity preserves its recorded settings and history; the host can prepare an older Workspace registration before the Client opens it. Concurrent navigation shares one admission request.

The direct-device provider uses a private, bounded manifest to record attachment intent before the Incus device change and commits readiness only after exact device and guest mount verification. A lifetime filesystem lease excludes another manifest writer. Interrupted intent recognizes only the exact prior or prospective device list; recovery neither removes unknown devices nor replaces the retained VM. Selected guest paths derive from the canonical source identity and survive restart. Disposal waits for owned attachment work and releases the lease while retaining mounts, files, commands owned elsewhere, and Session history. The [shared catalogue decision](../architecture/2026-10-17-shared-workspace-capacity.md) separates selected-directory count from PCI capacity while preserving this admission ordering.

This extends the [shared-environment decision](../simplification/2026-09-29-shared-environment-workspace.md), whose environment lifetime, immediate shared writes, Git authorization, and absence of per-turn transactions remain applicable. Workspace deletion removes registration only; it cannot revoke a directory shared by other Sessions.

## Alternatives considered

**Mount every directory beneath a broad Host parent.** This exposes unrelated projects and private files before a user selects them. Configured roots govern eligibility; only the selected directory becomes a device.

**Attach on the first failed model tool call.** Tool execution is too late to validate workspace selection, and a model-provided path cannot serve as the user action that authorizes another Host mount.

**Restart the VM or rebuild the runtime for every selection.** Other Sessions share commands, services, installed tools, and files in the retained VM. Live exact-device attachment avoids interrupting those owners.

**Treat the Workspace registry as the mount manifest.** Registry bootstrap, deletion, and failed registration have independent grouping semantics. Execution attachment needs its own crash-recoverable device intent and lifetime lease.

## Consequences

Selection may fail before registration even when its Host directory exists. An interrupted or failed request can retain authorized mount intent, so callers reconcile uncertain outcomes rather than blindly replaying mutations. Mount retention is environment-owned; automatic detachment and credential expansion are excluded. Deployments must explicitly configure selection roots and private storage, and qualify repeated live attachment on their Incus deployment before activation. Incus must allocate actual free PCI ports; the index-based allocator in Incus 6.0.0 can collide with an attached disk or select a missing bus. Attachment failure rejects admission and retains authorized recovery intent; the runtime never restarts the VM to obtain another port.
