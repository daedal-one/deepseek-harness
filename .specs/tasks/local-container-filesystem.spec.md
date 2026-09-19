---
id: TASK:fs/local-container-filesystem
type: task
status: accepted
summary: Implement the local-container filesystem provider over the process-owned Podman runtime.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/isolated-execution-world#c-world
  - REQ:sandbox/isolated-execution-world#c-lifecycle
  - REQ:sandbox/isolated-execution-world#c-data
  - REQ:sandbox/isolated-execution-world#c-evidence
labels: [filesystem, sandbox, container]
assignee: carlo
---

# Local container filesystem provider

## Acceptance

`dsh-fs-local-container` provides every `ctx.fs` operation through bounded stdin/stdout controller executions owned by `dsh-local-container-runtime`; Node never resolves or accesses the private backing directory. Exact configured host Session cwd aliases resolve only as `/workspace`, while unknown aliases, traversal, and symlinks outside that workspace reject without exposing host paths. The provider publishes the runtime owner as its execution-world identity, returns only POSIX container paths, enforces configured complete-file, byte-window, controller-output, and operation-time bounds, and registers cleanup that aborts and settles outstanding controller work. Container-side operations provide stable version tokens, canonical symlink identity, one non-recursive mutation lock per target, atomic publication, guarded write/edit rejection, and typed UTF-8 and binary failures. Controller cancellation and deadline expiry tear down the world when Podman cannot prove individual exec termination. Fake-controller and rootless Podman tests cover mapping, containment, exact byte bounds, UTF-8, atomic version races, cancellation, execution identity, and controller/file visibility; a generic subprocess provider remains separate work.
