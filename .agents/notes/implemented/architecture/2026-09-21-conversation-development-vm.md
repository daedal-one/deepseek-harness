# Agent Note: Conversation development VMs

Status: implemented

## Problem

The rootless execution world deliberately excludes networking, privilege escalation, and engine sockets. Development tasks can need Docker builds, multi-service stacks, databases, and browser tests, with services surviving ordinary turn completion. Exposing a host engine would give guest code authority over the source checkout and Harness credentials.

## Decision

The optional provider uses Incus-managed KVM guests behind an explicit effective-profile composition. Each guest owns Docker, Compose, browser binaries, and durable development volumes. Only its copied source directory is shared with a separate trusted maintenance controller. A project-local managed network and ACL deny private destinations, host public addresses, peer ingress, and IPv6; public HTTP, HTTPS, and fixed DNS resolver egress remain explicit. Guest process execution uses the Incus agent and systemd transient services. The agent continues to use ordinary coding tools.

Host-session admission and execution-world validation precede optional VM-provider lookup. Non-host owners resolve `developmentVms` through `serviceForAgent`; children use the same provider instance. A canonical versioned descriptor and SHA-256 fingerprint bind each recovery record to its project, storage, network, ACL, image, UID/GID, CPU, memory, disk, instance quota, and network policy. Recovery rejects legacy strings, provider drift, a changed live image, or a changed owner label.

The provider flushes completed writes, pauses guest CPUs, and stops the source-sharing virtiofs workers through validated pidfds before Git maintenance. Guest-agent availability alone does not admit commands: the workspace mount, Docker daemon, and systemd command path must also be ready. Environment-owned Git authorization is reissued and validated for each ordinary guest process, transferred through an in-memory stdin envelope, and excluded from persisted configuration, host argv, maintenance controllers, and diagnostics.

The existing isolated controller captures source, commits remaining changes, and returns immutable branches. Source artifacts and guest snapshots carry the same checkpoint hash. A pending journal separates artifact creation, guest retention, manifest promotion, and pruning, so the prior acknowledged pair survives until promotion. Durable transaction acknowledgements order commit, branch return, provenance storage, Session event persistence, and `lastTurn`; retries reuse content-addressed or persisted outcomes instead of duplicating effects. Recovery stops the retained guest before touching its source slot and restores the acknowledged disk generation when source RAM is lost.

The [conversation workspace decision](2026-09-20-conversation-git-workspace.md) retains Git transaction, admission, provenance, and recovery authority. The [container execution-world proposal](../../proposed/architecture/2026-09-18-local-container-execution-world.md) remains applicable to its independently supported provider. Neither note is fully superseded.

## Alternatives considered

**Host engine socket.** It permits arbitrary host mounts and host process control, defeating workspace isolation.

**Privileged Docker inside a physical-host container.** This retains a shared host kernel while relaxing the controls that justify unattended execution.

**Custom QEMU orchestration.** Incus provides image, disk, VM, and network lifecycle operations that would otherwise require a second infrastructure manager inside Harness.

## Verification

Focused tests use bounded process fakes to pin project-scoped network and ACL queries, canonical descriptor validation, live image and owner checks, guest authorization boundaries, writer-barrier failures, first-boot readiness, queued shutdown operations, preview authentication, and checkpoint ordering. Workspace fault injection covers source-artifact, guest-checkpoint, promotion, prune, commit, branch, provenance, Session event, and `lastTurn` boundaries. An external opt-in scenario exists for deployment-owned Incus, Docker, browser, preview, terminal, recovery, and network checks, but this change does not claim that a real Incus deployment or image has been qualified.

## Consequences

Guest-root file ownership must remain compatible with the unprivileged maintenance controller. Filesystem-sharing caches and helper processes participate in the writer barrier. A disk snapshot is crash-consistent, not an application transaction; databases must recover after abrupt guest loss. The project instance quota and retained-generation policy bound guest count and snapshots; deployment storage must cover live disks, the prior and current acknowledged generations, and one pending generation per guest. Preview content uses a separate cookie domain and one-use grants, so deployment needs a dedicated wildcard TLS route. A VM tunnel is a generic byte stream; HTTP timeout and disposal handling cannot assume native TCP socket methods. Shipped profiles remain unchanged, and operators must qualify their exact Incus host and image before custom enablement.
