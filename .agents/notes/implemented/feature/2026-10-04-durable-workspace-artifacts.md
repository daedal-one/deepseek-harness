# Agent Note: Durable workspace artifacts

Status: implemented

## Problem

Generated outputs need stable Workspace discovery and revision history after their creating Session stops or its disposable checkout disappears. Ordinary file previews read mutable files through Session authority. Executable outputs need an independent execution environment without the producing agent's files, credentials, network or Harness services.

## Decision

Artifacts are an opt-in capability with a Service Definition, durable and runtime Providers, and model/API/Client Consumers. The accepted [requirement](../../../../.specs/artifacts/durable-artifacts.spec.md) owns obligations; the accepted [TASK](../../../../.specs/tasks/durable-workspace-artifacts.spec.md) owns delivery evidence. The [artifact subsystem](../../../../docs/subsystems/artifacts.md) owns publication and presentation semantics, and the [bundle](../../../../packages/bundle/artifacts/README.md) owns profile composition.

Host-assigned artifact identities belong to exactly one Workspace. Immutable revisions freeze explicit assets, media types, digests, sizes, entry, execution policy and provenance. Publication verifies content-addressed attachment bytes before appending the Session event and awaits its persistence checkpoint before acknowledging a catalogue head. Expected-head mutation rejects lost updates; Session-scoped operation identities reconcile interrupted publication without duplicate revisions. Recovery uses durable Session evidence and does not activate agents. Abandoned reservations stay charged, and admission refuses overflow rather than pruning history.

The Workspace dropdown contributes a localized Artifacts action through an effect-owned extension point. A root-owned right-Sidebar view lists that Workspace's committed artifacts, including inactive and archived Sessions. Trusted controls provide source, rendered output, capabilities, history, comparison, restoration, original-byte export and expected-head text editing. Historical selections remain pinned; restoration creates a new revision. Selected-text agent requests become ordinary durable user input in an explicitly selected authorized Session. Authored clicks and messages cannot submit those requests.

## Security ownership

Document policy disables artifact-authored execution. Interactive-local permits bounded computation over the published assets and transient input. Neither policy grants files, credentials, Session history, Workspace inventory, network, persistent application storage, Harness/model/tool access or another artifact's state. Every authenticated API operation checks Workspace ownership; an artifact identifier or content digest is not a bearer grant.

Executable rendering uses a distinct rootless Podman allocation with private network/PID/IPC namespaces, no Host or Session bind mounts, read-only root, bounded temporary storage, no capabilities, no new privileges, confined seccomp and cgroup limits. The provider checks requested Engine settings and effective kernel controls before sending assets through private pipes. Chromium retains its namespace sandbox and renders authored content in an opaque iframe. The revision's complete asset set is fixed; dependency declarations cannot discover files or fetch resources.

The Harness receives bounded static PNG frames and inert text, never authored DOM or a renderer RPC connection. Trusted UI gestures forward only closed pointer, key and text inputs. Private invocation identities bind channels to exact revisions. Cancellation, replacement, deletion and disposal revoke execution and reject stale messages. Failed removal retains cleanup ownership and quarantines new allocations. Engine logging is disabled so private presentation pipes do not become container logs.

The [runtime provider](../../../../packages/artifact/artifact-runtime-podman/README.md) owns configuration and qualification. It is disabled in the bundle until explicitly enabled with an absolute rootless Engine socket, digest-pinned image, Engine-host seccomp profile and complete deployment limits. Unavailable or rejected execution never falls back to the ordinary HTML preview or Session sandbox.

The existing [document-preview decision](../architecture/2026-09-08-document-preview-operations.md) and [file-read authority decision](../architecture/2026-09-09-workspace-file-read-authority.md) remain authoritative for general file previews. Their permitted networking and Session-authorized related-file reads cannot satisfy artifact isolation; artifacts reuse trusted Sidebar/Resource layout and attachment storage without acquiring those privileges.

## Alternatives considered

**Represent an artifact as a Workspace filename.** Mutable files lose previous content after overwrite or cleanup and give reads Session authority. Immutable publication separates output retention from source lifetime.

**Reuse ordinary HTML preview with stronger iframe flags.** An opaque iframe protects application-origin access but cannot independently enforce all egress, CPU, memory and lifetime promises. CSP is defense in depth inside the separately confined runtime.

**Run authored code in the creating Session's container.** The agent's environment contains its checkout and can possess network or repository grants. A distinct allocation excludes that authority regardless of the Session sandbox.

**Expose generic tool or filesystem calls through postMessage.** An invocation token would acquire Host authority. The closed presentation protocol permits no artifact-to-agent/tool broker or capability expansion.

**Start with public sharing and persistent applications.** Sharing and writable app data require separate authorization, retention and abuse controls. This capability retains local immutable outputs and bounded transient interaction.

## Verification

The real qualification suite exercises document script denial, local computation, direct TCP/UDP/DNS denial independently of CSP, redirects, WebRTC, workers, opaque-origin storage/parent access, Host/Session file exclusion, cross-invocation isolation, forged messages/navigation/download attempts, output exhaustion, memory/CPU bounds and lifetime teardown. It uses a Linux ARM64 rootless Podman engine with the shipped digest-pinned browser recipe. Both document and interactive-local policies also pass real Web and Desktop viewer checks on a macOS ARM64 Host using that engine. Other architectures and engines are unqualified.

Real Loader and built-consumer checks cover publication, updates, restoration and cold recovery. Keyless Session snapshots and both SDK expected outputs preserve publication events. Focused unit coverage checks durable admission/integrity, exact-Workspace authorization, concurrency, stale-response rejection, allocation cleanup and menu disposal. A real-model Web flow verifies publication, direct editing, comparison, restoration, exact-byte export and restart recovery after archival and removal of the disposable checkout; its local GUI recording is release evidence rather than a repository binary asset.

## Consequences

Independent execution excludes the Session environment and gives the provider enforceable computation and teardown controls. It requires a maintained browser image, rootless engine, cgroup configuration and deployment-specific qualification. Raster presentation adds input/display transport cost and lacks semantic accessibility actions. Image, parser, browser and kernel vulnerabilities remain part of the trusted computing base; configured-denial evidence does not establish immunity to them.

Immutable retention consumes disk and bounded catalogue recovery work. Content-addressed deduplication does not replace authorization or accounting. Runtime and capability changes preserve admitted revision meaning and refuse unsupported execution. Exports carry an explicit indication that downloaded content runs outside the artifact sandbox. Public URLs, sharing ACLs, collaboration, arbitrary package installs, external services, persistent application storage and artifact-originated privileged calls require separately accepted capability work.
