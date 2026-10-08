---
id: TASK:tasks/deterministic-harness-deployment
type: task
status: accepted
summary: Make live-harness deployment deterministic and explain effective tool-policy review to agents.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/host-maintenance#c-handoff
  - REQ:sandbox/host-maintenance#c-deployment
  - REQ:sandbox/host-maintenance#c-evidence
  - REQ:guard/tool-policy-permission-mode#c-activation
  - REQ:guard/tool-policy-permission-mode#c-evidence
labels: [deployment, permissions, skills]
assignee: carlo
---

# Deterministic live-harness deployment

## Scope and impact

The deployment workflow uses the existing Daedal host handoff and an operator-owned deployment definition. It does not confer host authority, introduce a self-update command, change approval outcomes, or infer the deployed Host maintenance permission preset from its label. The tool-policy enforcer explains its actual activation and deferred approval behavior through logged runtime context and distinguishes policy-review deferrals from sandbox escalation. The operator-installed controller supplies exact-revision preparation, authenticated isolated qualification, digest-bound activation, durable status, and code rollback without replacing Session history. Participant-authority and in-session action machinery remain owned by [harness self-maintenance](harness-self-maintenance.spec.md).

## Acceptance

- A repository skill routes isolated execution through destination discovery and explicit host confirmation, transfers committed candidate identity and checks, and requires the destination to reload the same skill.
- Host execution requires an explicit deployment definition naming service ownership, candidate preparation and qualification, independent activation, authenticated verification, and Session-compatible recovery. Missing inputs stop deployment; paths, commands, credentials, and service names are not guessed.
- The workflow preserves the working release and companion capabilities, never restarts its own supervising process directly, reports uncertain activation without automatic replay, and records exact candidate and service readiness evidence.
- Model-visible policy context follows the enforcer's actual durable activation predicate, reports its configured approval threshold, and distinguishes exact-call policy retries from one-call file sandbox escalation. Providers continue to own tool coverage; guidance does not claim every tool is reviewed.
- Focused tests and a keyless recorded-session scenario cover effective activation, bypass, disposal, deferred feedback, and logged model context. Documentation records any unavailable host verification separately from source checks.

- An independent systemd unit owns each preparation or activation. Duplicate activation requests refuse replay; candidate or configuration drift requires new qualification. The operator installs the controller and definition with root ownership; agents receive only its bounded command interface.
- Preparation builds a committed ancestor of remote master in a detached release, runs the declared checks, and uses a separate Harness home with no production Sessions on an alternate loopback listener. Activation preserves release-owned dependency links, configuration, companions, and every existing Session prefix. Automatic code rollback requires unchanged persistence sources and never restores old Session data over new history.

## Verification

The tool-policy package tests cover logged effective activation and deferred approval feedback. The `tool-policy-deferred-context` and `deferred-tools-command-rules` recorded Sessions cover the shipped profile and deployment instructions. Handoff tests use a real destination Session and exercise preset admission, confirmation, cancellation, and duplicate delivery.

`scripts/server-deployment.spec.ts` runs the controller's private Python fixtures for locking, active-release protection, stale approval, duplicate submission, failed qualification, candidate drift, busy-host refusal, dependency targets, historical prefixes, and code recovery without replacing history. Release acceptance additionally requires a real isolated qualification receipt for the installed operator definition. Source checks, qualification, and approved live activation are separate evidence states.
