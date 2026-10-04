---
id: TASK:artifacts/durable-mvp-plus
type: task
status: accepted
summary: Implement Durable MVP+ workspace artifacts with independently sandboxed capabilities and Workspace sidebar discovery.
owners: [carlo]
progress: completed
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

Implement the accepted [artifact requirement](../artifacts/durable-artifacts.spec.md) and [design decision](../../.agents/notes/implemented/feature/2026-10-04-durable-workspace-artifacts.md). Commit trailers reference `TASK:artifacts/durable-mvp-plus` and the affected requirement clauses.

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

Public URLs, sharing ACLs, collaborative editing, persistent app storage, arbitrary npm installs, external services, artifact-originated model/tool calls and grant expansion are separate work. Deployment and plugin activation are installation-specific operations outside this task.

## Release evidence

The implementation checkpoint is `ff77d1e4260140067c3c8271a5e22ba31a3325ee`. Its clean built Web profile and normal Electron development shell use isolated durable state and the real OpenRouter DeepSeek V4.1 Flash model for publication. Web uses the shipped browse directory-picker backend and an isolated loopback port. Both viewers pass document script denial and interactive-local computation with parent-origin, storage and Node access denied. The real rootless qualification suite passes all 15 cases; effective controls include zero capabilities, no new privileges, the configured seccomp profile, private loopback-only networking and cgroup-v2 CPU, memory and PID enforcement.

The qualified combination is a macOS ARM64 Harness Host with a Linux ARM64 rootless Podman 5.8.3 engine and the shipped locked renderer recipe. The tested image is `localhost/dsh-artifact-browser@sha256:8befd974ba72fa3727ac579ddc5c15e10fa6ba787fb02769773c8ddefa898902`. Other engines and architectures remain unqualified; the bundle leaves rendering disabled until explicitly configured.

Focused checks pass: 268 artifact tests with per-file full coverage, 72 runtime lifecycle tests with per-file full coverage, 378 shared Workspace/Sidebar/Engine/Loader tests, 142 package-policy and menu tests, 78 normalizer tests with full coverage, built Loader publication/update/restore/restart, two keyless artifact Session/TypeScript SDK replays and the Python recorded-artifact projection. Strict Host/Client typechecking, full lint, the committed build, all 16 hygiene checks, all 32 documentation checks and the website build pass.

The real-model GUI run publishes two artifacts, edits the counter, compares and restores its original revision, verifies original-byte export, archives the creating conversation and reopens the catalogue after server restart and deletion of its empty disposable checkout. Cold history retains the edited and restored bytes. Desktop reopens the same archived outputs without activating the creating agent. The six-state 16-second GUI storyboard and decoded visual checks are retained locally under the ignored `.playwright-mcp/artifacts-release/` directory; no provider fixture or synthetic Session event supplies its artifacts. The repository-declared Playwright fallback supplies browser control after repeated agent-browser capture failures. Screenshot hold times do not represent operation latency.
