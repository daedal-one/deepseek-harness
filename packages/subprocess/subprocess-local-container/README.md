---
description: "Rootless Podman process-container provider for the DeepSeek Harness subprocess seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-subprocess-local-container

## Summary

`dsh-subprocess-local-container` implements `ctx.subprocess` in the execution world owned by `dsh-local-container-runtime`. Each ordinary process or terminal receives one sibling rootless Podman container with the same image, private workspace bind, configured private network mode, read-only root, private `/tmp`, dropped capabilities, non-root user, and resource controls. Removing that container is the provider's descendant-quiescence primitive. Mount it only with the matching runtime and filesystem provider in an explicit opt-in composition.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand lifecycle and output](#understand-lifecycle-and-output)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the runtime first and configure every exact host Session cwd alias that represents `/workspace`.

```yaml
- name: '@deepseek-ai/dsh-subprocess-local-container'
  config:
    cwdAliases:
      - /home/user/project
    controlOutputBytes: 4096
    controlTimeoutMs: 10000
```

| Field | Default | Meaning |
|---|---|---|
| `cwdAliases` | required | Exact host Session cwd values mapped to `/workspace`. |
| `controlOutputBytes` | required | Complete response bound for executable and terminal-control helpers. |
| `controlTimeoutMs` | required | Deadline for executable lookup, spill publication, and bounded control work. |

<a id="understand-lifecycle-and-output"></a>
## Understand lifecycle and output

The provider attaches before starting each process container, decodes Docker's byte-framed non-terminal streams with backpressure, and exposes raw terminal bytes for TTY processes. Collected streams keep the exact configured byte tail. When a configured spill remains within its cap, the provider publishes the complete bytes under `/workspace/.dsh-spill`; the matching `ctx.fs` provider can read that path after the process container is removed.

Natural process exit and explicit termination both end at force-capable container removal. The runtime tracks every sibling and refuses to remove the shared backing directory until all siblings are gone. `maxLiveProcesses` on the runtime bounds concurrency; CPU, memory, and PID controls apply per sibling, so the aggregate maximum is the configured per-container bound multiplied by the owner plus that concurrency limit.

Terminal foreground inspection runs a fixed bounded helper inside the process container. Signals target the reported foreground process group; group 1 uses the Engine's container signal operation because Linux does not expose PID 1 as a signalable negative process group inside the namespace.

<a id="model-experience"></a>
## Model Experience

Indirectly, through shell, terminal, search, and LSP consumers that render container paths and process results.

#### KV Cache effect

No direct invalidation: this provider registers no request prefix; its consumers own model-visible results.

## Known Limitations and Deferred Work

- The workspace begins empty; import and export remain deployment work.
- Writable `/workspace` is mounted `noexec`; interpreters can run source files, while directly executing newly built native binaries is intentionally unavailable in this first profile.
- Process-container limits are per sibling rather than one shared cgroup. `maxLiveProcesses` provides the aggregate bound.
- Terminal input-wait detection currently reports the Engine terminal's foreground group as waiting; a trusted image helper can provide syscall-level wait evidence if a future consumer needs that distinction.
- Dynamic terminal resize is supported by the runtime primitive but is absent from the current shared `SubprocessTerminalHandle` contract.

**Runtime invariant:** No companion is published. The startup validator owns the only cross-provider identity relation, and process lifecycle facts are enforced at the runtime service seam.

### Dev Note

None.
