# Agent Note: Local container execution world

Status: proposed

## Problem

Daedal's policy-reviewed permission mode adds one or more model calls before unmatched supported tools execute; deterministic safe-read rules already avoid that cost for recognized operations. Repeated review is unnecessary for file and process effects when configured container controls prevent those effects from reaching the host. The existing `ctx.sandbox` service cannot supply that boundary: it confines writes in the host path namespace and deliberately does not govern reads, network, credentials, processes, or IPC.

A private directory below `/tmp` is storage, not isolation. The runtime must place every model-controlled file and process operation in one container path and process namespace while leaving the Harness control plane on the host. Filesystem and subprocess providers must share the same world or commands and file tools observe different state.

## Proposal

Add an opt-in local-container provider family parallel to the E2B family. One runtime owner uses the Docker Engine API through an explicitly configured Unix socket, creates a random owner-only backing directory below `/tmp`, starts one container from a required digest-pinned image, and owns final teardown. Matching filesystem and subprocess providers implement `ctx.fs` and `ctx.subprocess` against that owner. Generic Bash, search, terminal, LSP, and job consumers retain their domain logic; subprocess-backed child agents remain absent because their binaries, external transports, and credentials need separate brokering. The existing [portable execution-world decision](../../implemented/architecture/2026-07-28-portable-execution-world-consumers.md) continues to own the shared provider interfaces, while the [same-world sandbox decision](../../implemented/feature/2026-07-06-sandbox.md) remains authoritative for host-path confinement; neither is superseded.

The first composition owns exactly one execution world per DSH process. It starts empty, uses a read-only image root, mounts the private directory at `/workspace`, allocates a private in-memory `/tmp`, removes network access and Linux capabilities, prevents privilege escalation, and applies configured CPU, memory, PID, output, and lifetime bounds. It forwards a replacement allowlisted environment rather than inheriting the host environment; consumers may add explicit non-secret operation identifiers such as session ids. The composition omits host-native and external-effect tools that cannot be bounded by the volume, and it does not mount the host workspace, home, Harness data, credential stores, devices, IPC sockets, or the Docker socket. The host filesystem supplies the backing directory's capacity; the first implementation makes no storage-quota claim.

The filesystem and subprocess service definitions expose an opaque execution-world identity. Local providers share the host identity, remote providers publish their runtime owner's identity, and a composition validator rejects a mismatched pair before agents start. The container providers also translate the composition's configured Session cwd aliases to canonical `/workspace`; every other cwd fails rather than being passed through, and model-visible paths never contain the private host backing path.

Contained file and process operations use non-interactive authorization and do not activate model-backed tool policy. Browser, Web, MCP, model, persistence, credentials, settings, telemetry, plugin management, and other host or external effects retain separate authorization because the container does not bound them. Acceptance requires a negative contained-operation policy trace and a positive external-operation authorization trace, so a global approval bypass cannot qualify.

The trusted computing base is the digest-pinned image, Docker Engine and its configured root mode, the host kernel, and the Harness control plane. Startup inspects the created container and engine capabilities and fails when the requested mount, namespace, security, or cgroup controls are unavailable. The provider claims those verified controls, not resistance to a compromised engine, kernel, image, or host administrator.

## Full agent desktop direction

A later optional runtime can move the complete agent-facing desktop, browser, external tools, and child-agent processes into one isolated environment. That design requires a versioned host/sandbox control protocol for model calls, sessions, credentials, user interaction, artifacts, and UI streaming; explicit network egress mediation; and a secret broker that does not materialize host credentials in the sandbox. It is a deployment model rather than an extension of the filesystem/subprocess providers and remains outside this implementation.

Per-Session local containers also remain separate work. The current filesystem and subprocess services are process-global, and agent presets share one standing composition. Per-Session worlds require one durable execution-environment selection plus atomic initiator-aware routing across both services and every agentless caller; permission presets cannot truthfully encode that selection.

## Performance evidence

The user operation is one admitted no-op shell call from `tools/pre-execute` entry through its settled tool result. Evidence reports container creation separately from at least twenty warm operations in one execution world, records every sample and p50/p95, and excludes model and external-network time from the local execution measurement. The comparison route records the same no-op through policy review with its model time identified rather than hidden. The execution-world composition is presented as the faster replacement only when warm end-to-end tool latency improves materially and container startup amortizes over an ordinary multi-operation turn without unbounded retained host or container state.

## Alternatives considered

**Extend `SandboxMode` with a container mode.** Rejected because `ctx.sandbox` wraps argv in the host path namespace and has no filesystem-provider, lifecycle, network, credential, or IPC contract. A mode name cannot turn same-world confinement into an execution world.

**Treat a `/tmp` directory as the sandbox.** Rejected because path placement does not hide host reads, processes, sockets, credentials, devices, or network access.

**Mount the host workspace into the container.** Rejected for the first implementation because unrestricted operations would then mutate host state directly. Explicit bounded import and export can be added without weakening the default boundary.

**Create one container per tool call.** Rejected because terminals, language servers, background jobs, and subprocess-backed child agents need persistent process identity and shared state. Per-call startup also replaces policy latency with repeated container latency.

**Reuse the E2B provider.** Rejected because it requires a remote credential and service, does not place its volume below local `/tmp`, and retains the remote image's network policy. Its three-package topology remains the implementation template.

**Move the complete Harness into the container immediately.** Rejected because model transport, credentials, session durability, UI, plugin loading, browser state, and human interaction need a larger control-plane protocol and security review. The execution-world split removes repeated authorization from the bounded coding world without conflating that deployment model.

## Acceptance criteria

The provider family and optional composition satisfy `REQ:sandbox/isolated-execution-world`. Focused tests prove that filesystem, commands, search, terminals, and LSP observe one private world; a mismatched filesystem/subprocess pair fails load; unsupported child-agent providers are absent; setup and teardown fail closed and reach quiescence; contained operations append no tool-policy decisions; and an external operation still takes its independent authorization path. Mandatory Docker Engine tests for every supported root mode prove host sentinels and sensitive ambient environment values remain unreachable, network and device access are unavailable, namespace and resource controls are active, and cleanup removes the container and private directory. The composition cannot disable review while that real-engine lane is absent or skipped.

## Risks

Docker exec has no API for signalling one exec process, and terminal resizing alone does not establish process-range ownership. The subprocess provider needs an in-container supervisor protocol that owns each process range, signals that range, and reports quiescence; killing an API stream or the shared container is not a substitute. Container images are deployment inputs and can contain credentials or unsafe defaults, so image selection is trusted configuration, must use a digest, and receives no implicit production default. Rootless and rootful engines have different host consequences and cgroup support; each supported mode needs startup capability checks and mandatory real-engine coverage rather than silent weakening. Empty ephemeral storage also risks user confusion and data loss until explicit import/export exists.
