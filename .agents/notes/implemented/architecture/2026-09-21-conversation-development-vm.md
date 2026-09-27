# Agent Note: Conversation development VMs

Status: implemented

## Problem

The rootless execution world deliberately excludes networking, privilege escalation, and engine sockets. Development tasks can need Docker builds, multi-service stacks, databases, and browser tests, with services surviving ordinary turn completion. Exposing a host engine would give guest code authority over the source checkout and Harness credentials.

## Decision

The optional provider uses Incus-managed KVM guests behind an explicit effective-profile composition. Each guest owns Docker, Compose, browser binaries, and durable development volumes. Only its copied source directory is shared with a separate trusted maintenance controller. A global managed bridge and ACL reserved for the Incus project deny private destinations, host public addresses, peer ingress, and IPv6; Incus bridge networks cannot be owned by a non-default project. Public HTTP, HTTPS, and fixed DNS resolver egress remain explicit. Guest process execution uses the Incus agent and systemd transient services. The agent continues to use ordinary coding tools.

Host-session admission and execution-world validation precede optional VM-provider lookup. Non-host owners resolve `developmentVms` through `serviceForAgent`; children use the same provider instance. A canonical versioned descriptor and SHA-256 fingerprint bind each recovery record to its project, storage, network, ACL, image, UID/GID, CPU, memory, disk, instance quota, and network policy. Recovery rejects legacy strings, provider drift, a changed live image, or a changed owner label.

The provider flushes completed writes, pauses guest CPUs, and stops the source-sharing virtiofs workers through validated pidfds before Git maintenance. Guest-agent availability alone does not admit commands: the workspace mount, Docker daemon, retained containers outside restart or unhealthy states, and systemd command path must also be ready. Environment-owned Git authorization is reissued and validated for each ordinary guest process. The guest launcher disables terminal echo and acknowledges readiness before the runtime transfers the in-memory stdin envelope, which remains excluded from terminal output, persisted configuration, host argv, maintenance controllers, and diagnostics.

Ordinary commands run as collected transient systemd units. Terminal controls wait within the configured operation bound for systemd to publish the unit's main process. If a unit stop races normal completion, final termination accepts only systemd's exact not-loaded diagnostic for that owned unit; any other stop failure closes the runtime.

The existing isolated controller captures source, commits remaining changes, and returns immutable branches. Source artifacts and guest snapshots carry the same checkpoint hash. A pending journal separates artifact creation, guest retention, manifest promotion, and pruning, so the prior acknowledged pair survives until promotion. Durable transaction acknowledgements order commit, branch return, provenance storage, Session event persistence, and `lastTurn`; retries reuse content-addressed or persisted outcomes instead of duplicating effects. Recovery stops the retained guest before touching its durable source directory and restores the acknowledged pair when either side is missing.

The [conversation workspace decision](2026-09-20-conversation-git-workspace.md) retains Git transaction, admission, provenance, and recovery authority. The [container execution-world proposal](../../proposed/architecture/2026-09-18-local-container-execution-world.md) remains applicable to its independently supported provider. Neither note is fully superseded.

## Alternatives considered

**Host engine socket.** It permits arbitrary host mounts and host process control, defeating workspace isolation.

**Privileged Docker inside a physical-host container.** This retains a shared host kernel while relaxing the controls that justify unattended execution.

**Custom QEMU orchestration.** Incus provides image, disk, VM, and network lifecycle operations that would otherwise require a second infrastructure manager inside Harness.

## Verification

Focused tests use bounded process fakes to pin the project quota and dedicated global network and ACL queries, canonical descriptor validation, live image and owner checks, guest authorization boundaries, writer-barrier failures, first-boot readiness, queued shutdown operations, preview authentication, and checkpoint ordering. Workspace fault injection covers source-artifact, guest-checkpoint, promotion, prune, commit, branch, provenance, Session event, and `lastTurn` boundaries. On the reserved remote validation host, the pinned local image passed the deployment-owned Incus, Docker, Compose, PostgreSQL, Chromium, authenticated preview, terminal, Git return, durable-source recovery, and host-network denial checks.

## Consequences

Guest-root file ownership must remain compatible with the unprivileged maintenance controller. Filesystem-sharing caches and helper processes participate in the writer barrier. A disk snapshot is crash-consistent, not an application transaction; databases must recover after abrupt guest loss. The project instance quota and retained-generation policy bound guest count and snapshots; deployment storage must cover live disks, the prior and current acknowledged generations, and one pending generation per guest. Preview content uses a separate cookie domain and one-use grants, so deployment needs a dedicated wildcard TLS route. A VM tunnel is a generic byte stream; HTTP timeout and disposal handling cannot assume native TCP socket methods. Shipped profiles remain unchanged, and operators must qualify their exact Incus host and image before custom enablement.
