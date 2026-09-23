# Agent Note: Explicit host-maintenance profiles

Status: implemented

## Problem

An isolated conversation can develop the Harness but cannot operate the host service that runs it. A permission named full access describes file policy within the mounted execution world and cannot make container processes control host systemd units.

## Decision

The [CLI profile option](../../../../apps/cli/reference/README.md#host-maintenance) `sandbox: false` selects existing full-access defaults only for a composition carrying the enabled standard host providers and policy rows. The final derived patch layer is shared by config dumps, boot, and live reload. The option does not mutate environment variables, replace providers, overwrite Session permissions, or confer administrative operating-system privileges.

The [conversation workspace decision](2026-09-20-conversation-git-workspace.md) remains the authority for container ownership, recovery, and Git return. Its isolation and data-transfer decisions remain active; this option supplies an independent host launch path and supersedes none of them. Agents request a handoff through existing user interaction. A new host session receives the task and committed work; an active container session never silently changes its filesystem namespace.

The [operator-admitted host conversation](2026-09-23-admitted-host-conversations.md) decision adds an explicit mixed-Host path while retaining these launch-profile and handoff guarantees.

## Alternatives considered

**Change the execution world with a permission selector.** Existing permission events record sandbox mode and approval policy. They do not transfer process ownership, durable workspace recovery, filesystem paths, or background jobs, so treating them as a container-to-host transition would misrepresent what is running.

**Disable every policy plugin.** Host execution still needs ordinary observation rules, durable permissions, and independently enforced external-tool authorization. Selecting the established full-access defaults retains those mechanisms and lets a user deliberately narrow a session again.

**Mount a host-control socket inside the container.** A general host shell or systemd socket gives container commands ambient host authority and invalidates the contained-operation review bypass. A separately launched host composition makes the grant explicit.

## Consequences

The option is limited to standard host-backed profiles; custom remote providers fail before boot rather than pretending to be unconfined host execution. Existing permission preferences retain precedence, so an operator inspects the effective session setting as well as the profile dump. Launch-profile switching is not a model tool, and self-restart remains owned by an external service supervisor.

## Testing

Focused composition and manifest tests cover unchanged defaults, invalid options, preservation of authored fields, and rejection of disabled or replaced host providers. Real local filesystem and subprocess tests prove full-access execution without invoking a sandbox runner and prove that an explicit read-only Session event still denies writes. Deployment health and rollback evidence are separate from these source tests.
