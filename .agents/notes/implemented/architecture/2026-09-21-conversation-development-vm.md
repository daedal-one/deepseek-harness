# Agent Note: Conversation development VMs

Status: implemented

## Problem

The rootless execution world deliberately excludes networking, privilege escalation, and engine sockets. Development tasks need Docker builds, multi-service stacks, databases, and browser tests, with services surviving ordinary turn completion. Exposing a host engine would give guest code authority over the source checkout and Harness credentials.

## Decision

The optional provider uses Incus-managed KVM guests behind an explicit conversation composition. Each guest owns Docker, Compose, browser binaries, and durable development volumes. Only its copied source directory is shared with a separate trusted maintenance controller. A host-enforced network ACL denies private destinations, host public addresses, and IPv6; public HTTP(S) supports dependency downloads. Guest process execution uses the Incus agent and systemd services. The agent continues to use ordinary coding tools.

The provider flushes completed writes, pauses guest CPUs, and stops the source-sharing virtiofs workers through validated pidfds before Git maintenance. Guest-agent availability alone does not admit commands: the workspace mount, Docker daemon, and systemd command path must also be ready. The existing isolated controller captures source, commits remaining changes, and returns immutable branches. Guest disk snapshots pair with source checkpoint generations. Failed maintenance retains the barrier. Recovery stops the retained guest before touching its source slot and restores the acknowledged disk generation when source RAM is lost.

The [conversation workspace decision](2026-09-20-conversation-git-workspace.md) retains Git transaction and recovery authority. The [container execution-world proposal](../../proposed/architecture/2026-09-18-local-container-execution-world.md) remains applicable to its independently supported provider. Neither note is fully superseded.

## Alternatives considered

**Host engine socket.** It permits arbitrary host mounts and host process control, defeating workspace isolation.

**Privileged Docker inside a physical-host container.** This retains a shared host kernel while relaxing the controls that justify unattended execution.

**Custom QEMU orchestration.** Incus provides image, disk, VM, and network lifecycle operations that would otherwise require a second infrastructure manager inside Harness.

## Verification

The real-provider test executes an imported repository, Docker build, Compose application and PostgreSQL database, Chromium and WebSocket assertions, authenticated guest previews, terminal resize/input, automatic Git return with services alive, and paired source/disk recovery after RAM loss. It also exercises a background writer across settlement and cancellation checkpoints. Focused tests pin failed-barrier admission, first-boot readiness, queued shutdown operations, preview authentication, and pending-tunnel disposal. A recorded Session pins the save-failure diagnostic without adding workspace-management instructions to the coding agent.

## Consequences

Guest-root file ownership must remain compatible with the unprivileged maintenance controller. Filesystem sharing caches and helper processes must participate in the writer barrier. A disk snapshot is crash-consistent, not an application transaction; databases must recover after abrupt guest loss. The project instance quota and retained-generation policy bound guest count and snapshots; deployment storage must cover live disks, two retained generations, and a pending generation per guest. Preview content uses a separate cookie domain and one-use grants, so deployment needs a dedicated wildcard TLS route. A VM tunnel is a generic byte stream; HTTP timeout and disposal handling cannot assume native TCP socket methods.
