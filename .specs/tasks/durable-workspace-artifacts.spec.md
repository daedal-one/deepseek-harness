---
id: TASK:artifacts/durable-mvp-plus
type: task
status: accepted
summary: Implement Durable MVP+ workspace artifacts with independently sandboxed capabilities and Workspace sidebar discovery.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:artifacts/durable-artifacts#c-composition
  - REQ:artifacts/durable-artifacts#c-identity
  - REQ:artifacts/durable-artifacts#c-publication
  - REQ:artifacts/durable-artifacts#c-durability
  - REQ:artifacts/durable-artifacts#c-revisions
  - REQ:artifacts/durable-artifacts#c-capabilities
  - REQ:artifacts/durable-artifacts#c-runtime-isolation
  - REQ:artifacts/durable-artifacts#c-network
  - REQ:artifacts/durable-artifacts#c-interactions
  - REQ:artifacts/durable-artifacts#c-broker
  - REQ:artifacts/durable-artifacts#c-bounds
  - REQ:artifacts/durable-artifacts#c-workspace-menu
  - REQ:artifacts/durable-artifacts#c-catalogue
  - REQ:artifacts/durable-artifacts#c-viewer
  - REQ:artifacts/durable-artifacts#c-evidence
labels: [artifacts, workspace, sandbox, security, web, desktop]
assignee: carlo
---

# Durable MVP+ workspace artifacts

## Scope

Implement the accepted [artifact requirement](../artifacts/durable-artifacts.spec.md) and [design proposal](../../.agents/notes/proposed/feature/2026-10-04-durable-workspace-artifacts.md). Keep this task pending until runtime implementation begins; a specification, prototype viewer or passing storage test does not complete it. Commit trailers reference `TASK:artifacts/durable-mvp-plus` and the affected requirement clauses.

## Implementation sequence

1. Qualify the threat model and independent runtime for Web and Desktop. Prove direct network denial, exclusion of host/Session authority and effective resource/stop controls with hostile executable content. Select an existing maintained runtime where it establishes these guarantees; a browser iframe alone is insufficient qualification. Establish supported profile/platform combinations before connecting executable previews.
2. Add the Service Definition and immutable manifest/revision provider. Reuse verified content-addressed storage where its provider fits exact byte, durability and authorization requirements. Keep logical asset names separate from host and Session paths. Define expected-head mutation, idempotency, publication recovery, corruption refusal and bounded retention before exposing tools.
3. Add durable publication events, Workspace catalogue projection/recovery and authenticated API Consumers. Validate Workspace ownership on every operation, derive creation ownership from the initiating Session, and support cold/archived Sessions without activating an agent. Update Session declarations, generated catalogues and both SDK projections together.
4. Add model-facing create/publish, update and inventory/read operations through the normal tool pipeline. Persist bytes before visible publication. Reject automatic dependency discovery and runtime capability expansion. Add REAL-composition coverage and recorded-session cases for successful publication, failed capture and updates.
5. Extend the Workspace row menu with an effect-owned contribution mechanism if the current fixed menu has no suitable extension point. The artifacts Client contributes the localized Artifacts action only while its capability is available. Add the exact-Workspace catalogue and right-Sidebar artifact address/view without borrowing the active Session's file authority.
6. Add trusted source/rendered views, capabilities display, history, revision comparison/restoration and export. Add bounded direct text editing with expected-revision checks and selection-based agent edit requests recorded as user input. Retire stale loads, channels and runtime invocations on replacement, access revocation and disposal.
7. Add format-specific policy and qualified local interaction. Distinguish inert document rendering from executable interactive-local content. Freeze the revision's complete published asset set; execute without Session services or ambient credentials and terminate abusive invocations under configured bounds. Preserve an explicit unavailable state when a profile cannot execute safely.
8. Complete release evidence: hostile content against real Web/Desktop consumers, concurrent publication and crash recovery, integrity refusal, cross-Workspace catalogue tests, Loader/HMR disposal, focused built smokes, snapshots, SDK expected outputs, documentation gates and a real-server/model GUI GIF. Report untested platform combinations rather than inferring them from unit tests.

## Acceptance

The Workspace sidebar dropdown offers Artifacts; its catalogue lists committed outputs from that exact Workspace's active, inactive and archived Sessions. A user can open, compare, edit, restore and export revisions after restarting the Harness or removing the creating Session's disposable execution environment. Old revisions retain their original bytes and capability declarations.

Document and interactive-local profiles pass independent isolation and denial tests. A malicious artifact cannot read Session files or credentials, call Harness services, reach the network, spoof a trusted edit/approval, access another artifact, or escape configured computation and lifetime controls. Revocation and closure terminate the associated execution and retire its messages. An unavailable runtime never delegates to the ordinary HTML preview or Session sandbox.

## Exclusions

Public URLs, sharing ACLs, collaborative editing, persistent app storage, arbitrary npm installs, external services, artifact-originated model/tool calls and grant expansion are separate work. No runtime code, installed plugin, deployment or security qualification is established by this planning task's presence.
