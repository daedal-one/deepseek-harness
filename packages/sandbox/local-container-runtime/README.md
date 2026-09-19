---
description: "A rootless Podman Engine API owner for one disposable local container world, with fixed paths, private storage, and verified resource isolation."
kind: "package-reference"
---

# @deepseek-ai/dsh-local-container-runtime

## Summary

`dsh-local-container-runtime` creates one disposable rootless Podman container for an opt-in isolated execution world. It gives the matching filesystem and subprocess adapters a fixed `/workspace`, a private owner-only backing directory under `/tmp`, and a verified non-root toolchain. It rejects engines, images, and container inspections that cannot prove its network, mount, privilege, and cgroup resource controls. Choose it only with a trusted digest-pinned image and explicitly configured rootless Podman Unix socket. No shipped profile enables it.

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

Mount this owner before container-backed filesystem and subprocess adapters; those adapters use its one verified container identity and `/workspace` path.

### When to choose it

Choose this package for an explicitly assembled rootless Podman execution world whose trusted image includes the required coding toolchain. It does not provide filesystem or subprocess operations by itself, and host-backed providers remain the appropriate choice until the matching container adapters are present. The owner uses an explicit Unix socket. With `manageService: true`, it starts and owns the configured Podman API service; it never defaults to a Docker socket.

### Minimal configuration

Every value is required because these bounds and the Engine endpoint are deployment decisions. `environment` replaces the container environment rather than merging with the host; it accepts locale, path, terminal, pager, and non-secret Harness metadata through a fixed allowlist. Process overrides use the same allowlist; secret names reject and `DSH_HOME` must identify `/workspace/.dsh`.

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
```

| Field | Default | Meaning |
|---|---|---|
| `socketPath` | required | Absolute Unix socket path for the rootless Podman service. Managed sockets must be private paths below `/tmp`. |
| `manageService` | required | Start and own `podman system service` for this DSH process. |
| `podmanCommand` | required when managed | Absolute Podman executable used only to start the API service. |
| `serviceStartupTimeoutMs` | required | Maximum wait for a managed API socket to become ready. |
| `image` | required | Trusted image pinned with a SHA-256 digest; images declaring `VOLUME` are rejected. |
| `user` | required | Explicit non-root user supplied by the trusted image. |
| `environment` | required | Complete allowlisted replacement environment. |
| `memoryBytes` | required | Container memory upper bound. |
| `nanoCpus` | required | Container CPU upper bound in Docker NanoCPUs. |
| `pidsLimit` | required | Container PID upper bound. |
| `tmpfsBytes` | required | Private `/tmp` tmpfs upper bound in bytes. |
| `engineRequestTimeoutMs` | required | Maximum duration of one Engine API request. |
| `maxLiveProcesses` | required | Maximum concurrent sibling process containers; aggregate world resource use is bounded by this count plus the owner. |
| `lifetimeMs` | required | Finite maximum world lifetime. |
| `stopTimeoutSeconds` | required | Engine graceful-stop bound before force removal. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-local-container-runtime) is the exhaustive source for every accepted field and its JSDoc.

### Trusted runtime image

[`Containerfile`](Containerfile) defines the trusted toolchain image. Its base image is pinned to `docker.io/library/node@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9`, installs the shell, file, search, Git, Python, and build tools, and creates the non-root `dsh` user. It declares no `VOLUME` and sets no writable host mount.

### Podman integration evidence

The opt-in real-engine test uses `DSH_PODMAN_SOCKET` and `DSH_PODMAN_IMAGE`. Set both variables to a rootless Podman Unix socket and a digest-pinned image built from this package's `Containerfile`, then run:

```sh
pnpm run test:e2e -- packages/sandbox/local-container-runtime/tests/podman.e2e.ts
```

The test self-skips when either variable is absent. It creates the owner through the Engine API, externally inspects the resulting container, and confirms final container removal. It does not establish claims about engines or images that the test has not run against.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The owner first queries Docker-compatible Engine info and requires rootless mode, cgroup v2, the systemd cgroup driver, and enabled memory, CPU CFS-quota, and PID-limit support. It rejects image-declared volumes before it creates a random mode-0700 directory directly below `/tmp`. Provider adapters use its bounded stdin/stdout controller execution; cancellation or deadline expiry removes the whole world because the Engine API cannot prove individual exec termination.

The only configured host bind maps that directory to `/workspace`. The request replaces image process and environment defaults, runs `dsh`, reads the image root-only, uses a bounded `tmpfs` at `/tmp`, disables networking, drops `ALL` capabilities, enables `no-new-privileges`, and applies the configured resource limits. The owner inspects the created container, starts it, then inspects it again before `getContainer()` resolves.

Lifetime expiry and Cordis disposal stop the container, force-remove it when needed, and remove the private directory. Setup rollback and teardown aggregate cleanup failures with the retained container name and id, while the public diagnostics intentionally omit the host backing path.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Runtime owner, control verification, private-directory lifecycle, and readiness transaction. |
| [`src/engine.ts`](src/engine.ts) | Dockerode adapter for Podman's Docker-compatible Unix socket API. |
| [`src/types.ts`](src/types.ts) | Owner-facing Engine request, inspection, and diagnostic types. |
| [`tests/local-container-runtime.spec.ts`](tests/local-container-runtime.spec.ts) | Fake Engine API lifecycle and fail-closed unit coverage. |
| [`tests/podman.e2e.ts`](tests/podman.e2e.ts) | Environment-gated real Podman Engine API inspection. |
| — | No runtime invariant companion is published because the owner has one readiness transaction and no independent mutable relationship to compare. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Sandbox package group](../README.md) — local process confinement and this optional container owner.
- [Portable execution-world decision](../../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md) — shared filesystem and subprocess world identity.
- [Isolated execution world requirement](../../../.specs/sandbox/isolated-execution-world.spec.md) — accepted isolation and lifecycle obligations.
- [Podman API documentation](https://docs.podman.io/) — operator documentation for the configured rootless Engine service.

-----

<a id="model-experience"></a>
## Model Experience

None, as the runtime owns containers and registers no prompt, schema, or model tool.

#### KV Cache effect

No direct invalidation: this provider registers no request prefix; its consumers own model-visible results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints define the owner package boundary.

- **One world per process** — the matching filesystem and subprocess providers share one disposable workspace across Sessions; per-Session isolation requires a separate deployment.
- **No workspace import or output export** — the private volume starts empty and is removed at teardown.
- **Per-process output bounds** — the matching subprocess provider applies retained-output and spill bounds; the runtime bounds controller output.
- **Kernel mount metadata** — Linux `/proc/*/mountinfo` exposes the random host-side bind root to commands; provider paths and diagnostics suppress it, and it grants no host-namespace access.
- **No rootful or non-systemd cgroup support** — Engine info that cannot prove the required rootless cgroup controls rejects startup.
- **No reconnect or persistence** — the backing directory and container are process-owned ephemeral state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
