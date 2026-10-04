# Agent Note: Durable workspace artifacts

Status: proposed

## Problem

Generated outputs need stable Workspace discovery and revision history after their creating Session stops or its disposable checkout disappears. File previews expose current files through the addressed Session's filesystem and offer no artifact identity, preserved revisions or editing. Executable output additionally needs less authority than the agent that produced it: a successful publication must not authorize generated code to inspect the Session environment or use Harness services.

## Proposal

Implement Durable MVP+ as an opt-in artifact plugin capability, with a complete Service Definition, storage/runtime Providers and model/API/Client Consumers. The accepted [requirement](../../../../.specs/artifacts/durable-artifacts.spec.md) owns obligations; the accepted [TASK](../../../../.specs/tasks/durable-workspace-artifacts.spec.md) owns delivery order and evidence. No implementation or sandbox qualification is claimed by this proposal.

An artifact has a Host-assigned identity, one authoritative Workspace owner and an append-only revision history. A revision freezes the entry, explicit assets, media types, content digests, lengths, runtime profile, capability set and provenance. Trusted publication reads authorized sources, saves and verifies immutable objects, then records the revision. The creating Session is the provenance owner; a recoverable Workspace catalogue projects committed publication evidence without depending on live agents or mutable source files. Crash recovery and operation identities reconcile interrupted publication before a retry can create another visible revision.

The Workspace dropdown in the left Sidebar gains an Artifacts entry. It opens a bounded catalogue for that row's Workspace across active, inactive and archived Sessions. Opening an item addresses its committed artifact revision in the right Sidebar. Trusted controls offer source/rendered views, capabilities, history, comparison, restoration, export, direct text editing and selected-text requests for an agent edit. Restoration creates a new revision; edits use expected-head checks. A viewed historical revision remains pinned until the user selects another one.

## Security ownership

The initial profiles are document and interactive-local. Document renders supported content without artifact-authored execution. Interactive-local permits bounded computation over the published asset set and transient user input. Neither profile receives filesystem, network, credentials, Session history, Workspace inventory, model/tool access, application storage or other artifact state. Rendering does not use the Session environment. Deployment configuration selects only qualified runtime Providers; missing or unsupported enforcement makes execution explicitly unavailable.

| Interaction or capability | Document | Interactive-local | Authority owner |
|---|---|---|---|
| Display the exact revision and its published assets | Allowed | Allowed | Artifact reader and runtime Provider |
| Artifact-authored local computation | Denied | Allowed under runtime limits | Independent runtime Provider |
| Local controls and transient input | Viewer controls only | Allowed inside the invocation | Independent runtime Provider |
| Read files, Session context or other artifacts | Denied | Denied | No exposed capability |
| Network, external resources, devices or persistent state | Denied | Denied | Runtime enforcement |
| Copy or export committed content | Trusted UI gesture | Trusted UI gesture | Harness UI and authorized export Consumer |
| Edit source or restore a revision | Expected-head mutation | Expected-head mutation | Harness UI and artifact service |
| Ask the agent to change selected content | Trusted UI gesture | Trusted UI gesture | Durable user input Consumer |
| Grant expansion or artifact-originated agent/tool calls | Denied | Denied | No exposed capability |

Trusted shell controls and untrusted rendered content have distinct authority. Download, copy, source edits and agent requests originate only in the trusted UI. An agent request identifies the revision and selected content and becomes durable user input in the explicitly selected authorized Session. An artifact's local click or message cannot act as that user request. Any presentation channel authenticates the specific runtime instance and revision, validates bounded messages at reception and becomes unusable after revocation or disposal. MVP+ has no artifact-to-agent/tool broker and no persistent application state.

The existing [document-preview decision](../../implemented/architecture/2026-09-08-document-preview-operations.md) and [file-read authority decision](../../implemented/architecture/2026-09-09-workspace-file-read-authority.md) remain authoritative for general file previews. They intentionally permit Session-authorized related-file reads and browser networking. Artifacts therefore need a separate address, byte reader and execution path; a preview renderer registration cannot supply artifact authority. These decisions are adjacent reuse constraints, not superseded decisions.

An opaque iframe limits application-origin access, but it does not establish zero network egress, independently enforced CPU/memory limits or a terminable execution perimeter. The [iframe reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) distinguishes origin, script and navigation privileges; [CSP connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src) controls listed connection APIs rather than every possible outward effect. Runtime qualification must exercise navigation, redirects, subresources, workers, peer connections and custom protocols as well as fetch and sockets. A Provider needs effective runtime-level denial; CSP and sandbox flags add defense in depth. Where browser-local arbitrary code cannot satisfy these promises, executable rendering requires a separately confined runtime or remains unavailable on that platform.

The first qualification candidate is a sandboxed browser renderer in a distinct rootless container, with no network namespace access, a read-only runtime image, one read-only published revision, a private temporary filesystem, explicit CPU/memory/PID limits and an independently removable invocation. Reuse the configured container engine where suitable, but allocate neither the Session's container nor its writable volume or grants. The trusted Provider supplies assets and bounded input through private control pipes and returns bounded presentation output; the artifact receives no Harness RPC connection. Browser request policy additionally denies local-file schemes, remote resources and navigation outside the revision. Web and Desktop clients consume presentation through the same artifact API; a Desktop install without a qualified Provider advertises interactive execution as unavailable. Qualification must assess input latency, display bandwidth and accessibility before adopting this candidate. Container settings and image identity are required deployment choices, not inferred from the Session profile.

## Integration and reuse

The [attachment storage capability](../../../../packages/attachment/attachment/README.md) is a candidate for immutable file bytes and verified streamed reads. Artifact ownership, revision heads, manifests, catalogue recovery, admission limits and authorization remain with the artifact service; a digest or attachment reference is not an access grant. Exact published bytes remain separate from presentation transformations, and all selected assets are captured explicitly. A source filename or HTML dependency cannot trigger an additional read after publication.

The [Conversation assembly](../../../../docs/subsystems/conversation.md) can project publication events into artifact cards. The [Workspace row menu](../../../../packages/client/ui-workspace/src/client/rows/Rows.tsx) currently has fixed Rename/Delete actions; it needs an owned contribution point rather than a permanent artifacts dependency or an inert menu item when the plugin is absent. Shared Sidebar and Resource layout can host artifact views without giving untrusted content a generic file resource or transport handle.

## Alternatives considered

**Represent an artifact as a Workspace filename.** This supports cheap previews but loses prior content after overwrite or cleanup, gives reads the Session's authority and does not define capability isolation. Immutable publication separates output durability from source lifetime.

**Reuse the ordinary HTML preview with stronger iframe flags.** The current preview has intentional network access and Session-authorized dependency reads. Flags cannot alone prove all required egress and resource controls; artifact execution requires independent qualification and readers.

**Run artifact code in the creating Session's container.** That environment contains the coding agent's checkout and may possess network or repository grants. Reusing it violates the requested isolation even when the Session itself is sandboxed.

**Expose generic tool calls or filesystem reads through postMessage.** A frame holding an invocation token would acquire host authority. MVP+ allows only non-privileged presentation messages; further effects need separately accepted capability and authorization work.

**Start with public sharing and persistent applications.** Shared access and writable app data add independent authorization, retention and abuse-management responsibilities. Local durable outputs and bounded transient interaction establish the requested scope first.

## Acceptance criteria

The accepted TASK requires evidence for durable publication/recovery, expected-head edits, exact-Workspace discovery, retained historical revisions, format policy, denial enforcement, runtime resource limits and quiescent teardown. REAL Loader composition, keyless Session snapshots, both SDK projections and real Web/Desktop hostile-content tests accompany the implementation. A real-server/model GUI recording demonstrates publication, update, restart recovery and the Workspace menu/list/open flow. Acceptance records supported platform/profile combinations and explicitly reports unavailable ones.

## Risks

Independent runtime isolation is the main feasibility and schedule risk. Browser-local arbitrary JavaScript cannot be assumed to provide hard resource controls or full egress denial. A confined remote renderer introduces packaging, input/display transport and accessibility costs; a restricted declarative renderer reduces those costs but supports fewer applications. The runtime qualification milestone must resolve that choice before executable preview integration.

Immutable retention consumes disk and catalogue rebuilds need bounded recovery. Content-addressed storage reduces duplication but does not replace authorization or publication accounting. Changing active profiles or capability definitions must preserve the exact meaning of admitted revisions and fail explicitly for unsupported execution. User exports leave the Harness sandbox and need a clear indication that local execution is outside its protection. Browser/runtime and format-parser vulnerabilities remain within the trusted computing base; isolation evidence verifies the configured perimeter rather than claiming immunity to those vulnerabilities.
