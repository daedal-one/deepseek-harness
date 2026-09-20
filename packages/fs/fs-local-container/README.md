---
description: "Container-namespace ctx.fs provider for an explicitly mounted local Podman execution world."
kind: "package-reference"
---

# @deepseek-ai/dsh-fs-local-container

## Summary

`dsh-fs-local-container` implements `ctx.fs` in the verified Podman container owned by `dsh-local-container-runtime`. It resolves configured host Session cwd aliases to `/workspace`, performs reads, listings, versioned atomic writes, and literal edits through bounded controller executions, and returns only POSIX container paths. Node never opens the backing directory. Mount it only in an explicit opt-in composition with the runtime owner; no shipped profile loads it. Mount `dsh-subprocess-local-container` alongside it so commands, terminals, search, and LSP share this world.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the runtime owner first, then this provider. Each configured host Session cwd alias becomes the container's canonical `/workspace`; an unknown cwd fails instead of selecting a host or image path. Relative paths, absolute `/workspace` paths, parent traversal, and symlink resolution are checked by the controller in the container namespace. A symlink that resolves outside `/workspace` is rejected.

### Minimal configuration

Every bound is explicit because the container image and controller capacity are deployment decisions. `maxControllerOutputBytes` must accommodate two base64-encoded `maxFileBytes` values plus controller framing; the values below satisfy that relation.

```yaml
- name: '@deepseek-ai/dsh-local-container-runtime'
  config:
    socketPath: /run/user/1000/podman/podman.sock
    manageService: false
    serviceStartupTimeoutMs: 10000
    image: docker.io/example/dsh-runtime@sha256:<64 lowercase hex characters>
    user: dsh
    environment:
      HOME: /home/dsh
      LANG: C.UTF-8
      PATH: /usr/local/bin:/usr/bin:/bin
      DSH_OPERATION_ID: local-container
    memoryBytes: 268435456
    nanoCpus: 500000000
    pidsLimit: 128
    tmpfsBytes: 67108864
    engineRequestTimeoutMs: 10000
    maxLiveProcesses: 4
    lifetimeMs: 300000
    stopTimeoutSeconds: 5
- name: '@deepseek-ai/dsh-fs-local-container'
  config:
    cwdAliases:
      - /host/session-workspace
    maxFileBytes: 1048576
    diffBasisMaxBytes: 524288
    maxControllerOutputBytes: 3000000
    operationTimeoutMs: 10000
```

| Field | Default | Meaning |
|---|---|---|
| `cwdAliases` | required | Exact host Session cwd values mapped to `/workspace` |
| `maxFileBytes` | required | Largest raw or UTF-8 file content the provider reads, writes, or edits |
| `diffBasisMaxBytes` | required | Exclusive UTF-8 limit per overwrite-diff side |
| `maxControllerOutputBytes` | required | Combined stdout and stderr limit for one controller operation |
| `operationTimeoutMs` | required | Deadline for one filesystem controller operation |

The generated configuration catalog is the exhaustive source for accepted fields and JSDoc.

### What you can do

The provider implements every `ctx.fs` primitive: resolve, `stat`, `lstat`, whole and streamed UTF-8 text reads, bounded byte reads and ranges, stable one-level listings, atomic writes, and version-guarded literal edits. Target keys and versions are stable opaque container values. File aliases that resolve to one target share the same per-target mutation lock, so guarded mutations cannot interleave inside this provider. Controller deadline expiry or caller cancellation removes the execution world before the operation settles because Podman's exec API cannot prove individual process termination.

`processPath(target)` and `fileUrl(target)` use the POSIX container namespace. `processPathFromHostPath()` always returns `undefined`, and provider diagnostics do not expose the host backing directory or Engine socket.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

When the runtime conversation-workspace plugin is mounted, every operation captures the initiating conversation. Target keys include its execution-world identity, and cross-conversation targets reject before access. Source-root aliases map only to that conversation’s `/workspace`.

<details>
<summary>Implementation internals — click to expand</summary>

The runtime owner creates a bounded stdin/stdout controller execution for each operation. The provider sends one fixed Python controller program with an encoded request; path normalization, realpath checks, directory scanning, decoding, staging, publication, and version observation all run there. The provider validates every controller response before exposing it through `ctx.fs`.

A write stages an owner-only sibling file, preserves an existing file's mode, fsyncs the staged file, and atomically links or replaces the canonical target. An edit reads, verifies its optional version, finds the literal match, and uses the same publication path. The opaque version combines container `stat` identity, size, and high-resolution modification and change times.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Local container runtime](../../sandbox/local-container-runtime/README.md) — container ownership and Engine controls.
- [Filesystem subsystem](../../../docs/subsystems/filesystem.md) — the complete `ctx.fs` contract.
- [Portable execution worlds](../../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md) — shared filesystem and subprocess identity.

<a id="model-experience"></a>
## Model Experience

Indirectly, through filesystem consumers that render container paths, file contents, mutation results, and typed errors.

#### KV Cache effect

No direct invalidation: this provider registers no request prefix; its consumers own model-visible results.

## Known Limitations and Deferred Work

- **Matching provider required** — the startup validator rejects a `ctx.subprocess` provider whose execution-world identity differs from this filesystem provider.
- **No workspace import or export** — the container volume starts empty and is removed with the runtime owner.
- **Bounded whole-file streaming** — `streamText` validates one bounded controller result before yielding it; the shared contract's unbounded streaming optimization is unavailable in this provider.
- **Cancellation removes the whole world** — cancellation cannot target one Podman exec process safely, so the owner tears down the container and rejects later operations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
