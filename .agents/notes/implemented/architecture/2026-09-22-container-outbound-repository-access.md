# Agent Note: Container outbound repository access

Status: implemented

## Problem

An offline empty container cannot operate on a selected server repository or fetch its remote. Treating another source checkout as an alias for that empty workspace only hides the missing import. Copying host Git configuration would also copy executable credential helpers and credentials with unrelated authority.

## Decision

The [runtime](../../../../packages/sandbox/local-container-runtime/README.md#repository-remotes-and-outbound-access) offers explicit `none` and `outbound` network settings. Outbound uses a private rootless slirp4netns namespace, disables host-loopback access, and verifies that a listening host-loopback socket is inaccessible. Other namespace, mount, privilege, and resource controls remain required. Network access grants arbitrary outbound effects from sandbox processes; it does not claim to enforce read-only HTTP semantics.

Environment grants belong to a durable environment identity. Session attachments and workspace repository manifests are separate records. Separate chats share approved repository capabilities while retaining separate checkouts. Closing a chat does not destroy its environment's resources. Shared mutable checkouts remain unavailable without writer coordination.

The model-facing repository access request derives its environment from the initiating session, resolves configured sources or approved HTTPS remotes when remote attachment is enabled, and uses the human question service for new or broader authority. The decision names the environment-wide scope and lifetime. The broker compares grant revisions at approval and issuance, rejects stale results, and distinguishes fetch from push issuers. A grant is committed before attachment; a separate attachment receipt makes interrupted imports recoverable. Successful Git returns are retained independently when another repository fails.

A token is authority deliberately granted to the environment and readable by its processes. URL-scoped Git headers prevent ambient attachment to unrelated remotes, while the issuer limits the token's repository and operations. Revocation denies new issuance; tokens already issued can remain usable until their bounded expiry. Signing keys, global credential stores, and host working files remain outside the sandbox. The [host-maintenance decision](2026-09-21-host-maintenance-profiles.md) remains necessary for systemd and other host operations.

Remote-only repositories are cloned inside sandbox processes after the durable approval. The host receives a bounded Git bundle, verifies its starting revision and objects without network transport, and publishes a fresh environment-owned checkout for subsequent imports and immutable returns. Exact-origin provider configuration selects repository-scoped issuers; repository input cannot select a host path or executable. Failed clones preserve existing checkouts and remain retryable.

Workspace supervisors register one coalesced shutdown with the engine owner. Pending repository requests are cancelled and joined before checkpointing and child-container disposal. The managed engine remains available until those operations finish. The CLI accepts an inherited `DSH_SHUTDOWN_TIMEOUT_MS` so deployments can accommodate bounded checkpoint work; an interrupted shutdown retains an unclean RAM receipt for recovery.

Controller stdin is attached only for requests carrying bytes. Empty-input executable probes can finish before the Engine stream is attached; writing to that closed input can produce `EPIPE` and trigger world teardown. A missing executable is an ordinary exit result, and concurrent desktop-app probes must not close environment workspaces.

## Alternatives considered

**Host networking or host checkout mounts.** These grant access beyond the requested remote and page access and invalidate the existing namespace or storage controls.

**Copy global Git credentials into the repository.** This persists authority through checkpoints and can expose other repositories. Short-lived repository tokens confine that grant, while the signing key stays on the host.

**Keep all Git operations outside the sandbox.** This prevents ordinary fetch, pull, and dependency workflows despite explicit user authorization for network access.

## Consequences

Outbound network traffic can disclose sandbox content and mutate remote systems. Task authorization still determines which effects the agent may perform. Automatic host return does not push. Deployment qualification must exercise the intended remote and full imported repository; a successful public HTTPS request alone does not establish private Git access or repository import support.

## Testing

Focused tests cover offline preservation, outbound owner/process settings, host-network and host-loopback rejection, credential URL scope, expiry, safe errors, and source-preserving remote import. Real Podman tests cover network and filesystem isolation alongside HTTPS and Git access. Deployment acceptance additionally checks the assembled Web composition, authenticated private-remote reads, source working-file preservation, and companion health.
