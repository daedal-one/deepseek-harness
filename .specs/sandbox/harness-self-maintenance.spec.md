---
id: REQ:sandbox/harness-self-maintenance
type: requirement
status: accepted
level: MUST
summary: Let an authorized agent maintain its own harness in-session and drive host updates to a verified, reviewable handoff without the hosting process replacing itself.
owners: [carlo]
refines:
  - REQ:sandbox/host-maintenance#c-handoff
  - REQ:sandbox/host-maintenance#c-daedal-handoff
  - REQ:sandbox/host-maintenance#c-deployment
aspects: [host-handoff, verified-preparation, independent-activation]
categorized_under: []
---

# Harness self-maintenance

## Context

The harness can already be inspected and extended from inside a session, and a host update can already be requested through a human-confirmed handoff. What is missing is the automation around that boundary: work that is safely an agent's to do runs only when a human drives it, and the work that must cross to the host arrives as an unverified request a human has to investigate before approving.

:::{requirement id="harness-self-maintenance" level="MUST"}
- {#c-insession} An authorized participant MUST be able to run the repository's verification gates, inspect the composed configuration, install or update a plugin through the existing plugin management path, and reload a patch on a live profile. Each action MUST pass the same authority check as any other tool call and MUST be recorded in the acting participant's Session log.
- {#c-introspection} Live runtime introspection MUST be treated as a separately mounted capability rather than an assumed one, because no shipped bundle mounts those tools. A dynamic in-process package MUST NOT be presented as a durable change: its definitions do not survive a restart and it cannot remove a loader-owned, configured, or installed plugin.
- {#c-install-authority} Because the plugin management path performs no confirmation, registry allowlist, or signature verification, an automated participant MUST reach it through an explicit authorization decision and MUST NOT invoke it as a routine unattended action. The authorization and its outcome MUST be durably recorded.
- {#c-health} A maintenance report MUST present the evidence it gathered — gate results, the composed configuration, and the plugin inventory — and MUST NOT claim a health verdict produced by a diagnostics service, because no such service, report, or status query exists and the invariant registry reports nothing beyond throwing on violation.
- {#c-preparation} Preparing a host update MUST be separable from activating it. Preparation MUST resolve the target revision, apply and verify the candidate change, determine the exact remaining host steps, and record the verification evidence.
- {#c-activation} Activating a host update MUST require explicit human approval of an immutable qualified candidate. A host-backed session reached through the existing human-confirmed handoff MAY submit that approved operation to an operator-installed external controller. The controller MUST survive termination of the submitting Session and own activation, authenticated verification, durable status, and recovery. The submitting Session MUST NOT replace its running artifacts or directly restart its supervising process.
- {#c-review} The confirmation a human gives MUST be a review of an already-verified change rather than a manual investigation: it MUST present the target revision, the verification already performed, the exact host steps that remain, and the rollback position.
- {#c-rollback} A prepared update MUST preserve a known working release and MUST account for persisted Session compatibility when rolling back, so a failed candidate cannot strand the operator without a working service.
- {#c-evidence} Focused tests MUST prove that in-session maintenance actions are authority-checked and durably recorded, that the plugin management path is reached only through a recorded authorization, that introspection is refused when its tools are not mounted, that a maintenance report cites gathered evidence rather than a health verdict, that preparation produces the revision and verification evidence without touching the host, that an activation attempt outside a host-backed session is refused, and that the confirmation payload carries revision, checks, remaining steps, and rollback position.
:::
