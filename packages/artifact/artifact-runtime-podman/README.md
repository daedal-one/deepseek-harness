---
description: "Render local interactive HTML and inert documents without giving content the creating conversation\u2019s environment. A separate rootless browser container receives published bytes through a private pipe and returns images and inert text. A host must qualify its engine and pinned image before execution is available."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact-runtime-podman

## Summary

Render local interactive HTML and inert documents without giving content the creating conversation’s environment. A separate rootless browser container receives published bytes through a private pipe and returns images and inert text. A host must qualify its engine and pinned image before execution is available.

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

Configure an absolute rootless Podman socket, digest-pinned image, non-root user, engine-host seccomp profile path and complete resource bounds. Build [the locked image](image/Containerfile) and provision [the confined seccomp profile](image/seccomp.json) on the engine host. The [user guide](../../../docs/user/artifacts.md#qualify-executable-previews) explains when previews are available.
### Qualify the configured engine

Build from this package's locked recipe and provision its seccomp profile on the Engine host. With the Harness provider pointed at the Engine API socket, run the real qualification suite from the repository root:

```sh
export DSH_ARTIFACT_TEST_SOCKET="$DSH_ARTIFACT_SOCKET"
export DSH_ARTIFACT_TEST_IMAGE="$DSH_ARTIFACT_IMAGE"
export DSH_ARTIFACT_TEST_SECCOMP="$DSH_ARTIFACT_SECCOMP"
pnpm exec vitest run packages/artifact/artifact-runtime-podman/tests/qualification.spec.ts
```

All three values must be present, the image must name a digest, and the seccomp path must be readable inside the Engine host. An absent value skips this suite and does not qualify the deployment. Require all 15 cases to pass, then verify document and interactive-local artifacts through the actual Web or Desktop profile before enabling its runtime row. Repeat qualification when changing the image, engine, architecture, seccomp policy or resource limits. The suite allocates and removes independent test invocations and requires the normal Podman client for its Engine inspection and networking controls.

The qualified development combination is a macOS ARM64 Harness Host and Linux ARM64 rootless Podman 5.8.3 engine. Both Web and Desktop viewers pass document script denial and interactive-local input/denial checks on this combination. The locked image uses Playwright 1.63.0; image identity and effective enforcement remain deployment checks. Other architectures and engines are unqualified.

### Configuration

All listed fields are required deployment choices; the validated [Config declaration](src/index.ts) defines accepted ranges.

| Field | Default | Meaning |
|---|---|---|
| `socketPath` | required | Absolute rootless Engine API socket on the Harness host. |
| `image` | required | Trusted renderer image pinned by registry digest. |
| `seccompProfilePath` | required | Absolute confined seccomp profile on the Engine host. |
| `user` | required | Non-root renderer image user. |
| `memoryBytes` | required | Invocation memory cap; swap is disabled. |
| `nanoCpus` | required | Invocation CPU quota in billionths of one CPU. |
| `pidsLimit` | required | Maximum processes in the invocation cgroup. |
| `tmpfsBytes` | required | Maximum private temporary filesystem bytes. |
| `maxConcurrent` | required | Maximum active or allocating browser invocations. |
| `maxQueue` | required | Maximum pending input operations per invocation. |
| `maxInputBytes` | required | Maximum complete initialization or interaction command bytes. |
| `maxOutputBytes` | required | Maximum complete presentation response bytes. |
| `maxLifetimeMs` | required | Maximum invocation lifetime in milliseconds. |
| `operationTimeoutMs` | required | Engine operation and browser response deadline in milliseconds. |
| `width` | required | Fixed preview viewport width in pixels. |
| `height` | required | Fixed preview viewport height in pixels. |


-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Presentation streams use the private pipe with Engine logging disabled. Failed partial allocations remain owned for teardown retry. Every invocation has private network/PID/IPC namespaces, no host or Session bind, read-only root, bounded tmpfs, no capabilities and no new privileges. Startup proves cgroup enforcement, zero effective and bounding capabilities, no new privileges, seccomp filtering and a loopback-only network namespace before opening the presentation pipe. Chromium keeps its namespace sandbox; authored content also has an opaque origin. Only exact manifest assets receive virtual responses. No invariant companion is published because allocation verifies effective kernel controls and the private protocol directly; invocation removal is awaited.

The [source entry](src/index.ts) owns the exact service or registration behavior.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Artifact subsystem](../../../docs/subsystems/artifacts.md) — immutable publication and presentation protocol.
- [Using artifacts](../../../docs/user/artifacts.md) — trusted controls and runtime qualification.
- [Architecture](../../../docs/architecture.md) — composition and capability ownership.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no model-facing input.

#### KV Cache effect

This package adds no model request prefix; its Consumers own any cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints determine supported use.

- Executable qualification is established on the tested Linux rootless engine with the shipped ARM64 browser build. Other architectures need separately pinned and qualified images. Raster interaction has no semantic accessibility actions. Trusted PDF rendering does not enable PDF-authored JavaScript.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
