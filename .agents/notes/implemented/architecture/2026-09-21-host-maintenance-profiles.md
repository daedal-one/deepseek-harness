# Agent Note: Explicit host-maintenance profiles

Status: implemented

## Problem

An isolated conversation can develop the Harness but cannot operate the host service that runs it. A permission named full access describes file policy within the mounted execution world and cannot make container processes control host systemd units.

## Decision

The [CLI profile option](../../../../apps/cli/reference/README.md#host-maintenance) `sandbox: false` selects existing full-access defaults only for a composition carrying the enabled standard host providers and policy rows. The final derived patch layer is shared by config dumps, boot, and live reload. The option does not mutate environment variables, replace providers, overwrite Session permissions, or confer administrative operating-system privileges.

The [conversation workspace decision](2026-09-20-conversation-git-workspace.md) remains the authority for container ownership, recovery, and Git return. Its isolation and data-transfer decisions remain active; this option supplies an independent host launch path and supersedes none of them. The [Daedal handoff plugin](../../../../packages/integration/daedal-handoff/README.md) adds environment guidance and a confirmed transfer action only to the Daedal presets. The existing human-question service presents the configured host destination and full task. An authenticated receiver in a separately launched host Web profile validates host providers and creates a new ordinary Session; other presets retain manual handoff through user interaction. A new host session receives the task and committed work; an active container session never silently changes its filesystem namespace.

The [operator-admitted host conversation](2026-09-23-admitted-host-conversations.md) decision adds an explicit mixed-Host path while retaining these launch-profile and handoff guarantees.

The [handoff target profile decision](2026-10-01-host-handoff-target-profiles.md) gives each configured destination independent agent and permission defaults. Source settings do not choose destination authority.

The [live-harness deployment skill](../../../skills/dsh-deploy-live-harness/SKILL.md) separates workspace preparation, destination confirmation, host preflight, candidate qualification, external activation, and verification or recovery. An operator-owned deployment definition supplies exact service commands, independent controller ownership, authenticated success conditions, and Session-compatible recovery; missing inputs stop activation. The skill does not grant authority or provide a deployment controller. A destination without the definition can inspect configuration only, and uncertain activation requires a durable controller receipt rather than automatic resubmission.

## Alternatives considered

**Change the execution world with a permission selector.** Existing permission events record sandbox mode and approval policy. They do not transfer process ownership, durable workspace recovery, filesystem paths, or background jobs, so treating them as a container-to-host transition would misrepresent what is running.

**Disable every policy plugin.** Host execution still needs ordinary observation rules, durable permissions, and independently enforced external-tool authorization. Selecting the established full-access defaults retains those mechanisms and lets a user deliberately narrow a session again.

**Mount a host-control socket inside the container.** A general host shell or systemd socket gives container commands ambient host authority and invalidates the contained-operation review bypass. A separately launched host composition makes the grant explicit.

## Consequences

The option is limited to standard host-backed profiles; custom remote providers fail before boot rather than pretending to be unconfined host execution. Existing permission preferences retain precedence, so an operator inspects the effective session setting as well as the profile dump. Launch-profile switching is not a model tool, and self-restart remains owned by an external service supervisor. The handoff token remains on the host control plane; model arguments cannot choose a host, working directory, or credential. Unknown transport acceptance returns a stable destination Session identity and forbids automatic retries.

The [operator deployment controller](../../../../scripts/server-deployment/README.md) accepts an exact revision for preparation and a qualification digest for activation. Independent systemd workers own lifecycle changes. The submitting host conversation can share the maintained process because its durable operation receipt survives that process. Duplicate activation refuses replay, and automatic recovery changes code and release references without replacing newer Session history. Web readiness and companion startup share the configured health deadline for activation and recovery: a dependent companion can still be authenticating when Web first serves requests.

## Testing

Focused composition and manifest tests cover unchanged defaults, invalid options, preservation of authored fields, and rejection of disabled or replaced host providers. Real local filesystem and subprocess tests prove full-access execution without invoking a sandbox runner and prove that an explicit read-only Session event still denies writes. Handoff tests cover explicit consent, preset and root ownership, input and response bounds, duplicate delivery, cancellation, and quiescent disposal. A keyless Session fixture pins execution guidance, and a real Session Controller composition verifies destination admission. The [policy-context scenario](../../../../snapshots/session/tool-policy-deferred-context/snapshot.yml) loads the actual deployment skill through the skill tool; it pins the instructions, not live deployment execution. Deployment health and rollback evidence are separate from these source tests.
