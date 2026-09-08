# Agent Note: Forge Hub Code workspaces

Status: implemented

## Problem

The DeepSeek Harness Web application owns a local Workspace registry, while Forge owns registered project identity, repository links, and application projections. Embedding the ordinary Web application in the Hub without joining those models would expose a second project list: operators could select a Forge project outside the frame and still land in a different recent Harness Workspace inside it. Letting the browser create missing paths would also turn an unauthenticated presentation parameter into project provisioning authority.

## Decision

`dsh-forge-project-workspaces` accepts a bearer-authenticated complete replacement from the Forge Hub. It validates `ProjectId` as `PROJECT:<slug>`, derives the managed path `/workspaces/forge/<slug>`, materializes the linked Forgejo repository only when no checkout exists, and reconciles the Workspace registry's membership, titles, and order. Missing replacement rows lose only their registry entry; directories and Session logs remain recoverable.

The browser runtime treats an absolute `?workspace=` value as initial-selection intent only. It waits until that exact path appears in the registered Workspace baseline, opens or creates that Workspace's blank Session, and never falls back to another recent project. The Hub reads authenticated status from the persisted registry before rendering the frame and supplies the selected managed path; an audited operator action performs complete-roster synchronization, so project choice remains a Forge projection while conversation behavior remains native Harness behavior. The Forge deployment keeps the Workspace browser for managed Session history, disables directory adoption, and rejects public Workspace create, rename, delete, and reorder RPCs, preventing an operator from writing a second roster through the embedded origin.

Authenticated GET status is read-only and survives a process restart because it derives registrations from the Workspace registry. It verifies the exact canonical path and Git origin before reporting a project as established; it never adopts an unregistered directory. This avoids making a viewer reload depend on an operator mutation or an ephemeral Hub cache. Existing checkouts linked to another repository reject synchronization instead of being relabeled.

Repository credentials reach Git through the child process environment instead of a clone URL. Replacement requests serialize, and existing checkouts are never fetched or reset because preserving active edits is more important than making the directory mirror Forgejo automatically.

The shared Web and adapter runtime image includes native Forge development tools: Spec 0.8, Forge Intellect, Rust 1.97, Bun 1.3.11, Python 3.12, uv 0.11.3, and pnpm 11.7. Tool roots remain immutable and generated caches use temporary writable storage. Keeping those tools in the pinned runtime makes the edit/test loop reproducible without importing a mutable host toolchain or granting the coding process a Docker socket.

The Forge-only command mode exposes `forge_shell` and approval-bound `forge_push_branch`. Every repository inspection, instruction read, search, edit and build command uses the same Landlock launcher with a cleared environment and mandatory socket denial; other tool dispatch and scoped replacements are denied. A persona-only immutable preset removes implicit instruction-file readers and unusable native tool schemas. The CLI respects the deployment's explicit preset root, and disabling user roots prevents writable presets from adding ambient readers. Generic Harness defaults remain unchanged.

## Alternatives considered

**Let operators register directories in the embedded sidebar.** Rejected because the resulting list would not map one-to-one to Forge projects and a Harness-only Workspace could appear to be a Forge application.

**Encode the Forge ProjectId as a Harness WorkspaceId.** Rejected because WorkspaceId is a durable generated identity over a canonical path. Reusing an external identifier would couple the registry's storage semantics to one control plane and bypass its create/recovery rules.

**Make the Hub reimplement the conversation UI over the Forge session protocol.** Rejected for this slice because the Harness already owns the mature interactive browser experience. Forge retains its harness-neutral runtime for durable orchestration while the embedded provider-native UI remains an enrolled specialist surface.

**Keep native grep and file tools behind environment scrubbing.** Rejected because scrubbing a child environment does not prevent an unconfined child from reading a same-UID parent's environment or private configuration files. A single confined command tool covers ordinary source inspection and development commands without duplicating filesystem policy across native tools.

## Consequences

The Forge Web deployment has a dedicated authenticated catalog route and persistent Harness state. Its project roster is rebuildable from Forge, but working directories intentionally survive unregistration and existing repositories intentionally stop short of automatic refresh. The Web parent process retains its mounted authority and credentials. The explicit confidential Code tool mode confines model commands to one registered repository and private temporary storage; it does not isolate the Web parent. Mandatory socket denial prevents tool access to parent APIs and external networks; offline caches or trusted preparation are required for dependencies.

A real Loader composition verifies restart recovery from the durable registry, authenticated read-only status, retained dirty files, unregistered-directory exclusion, and disposal. Focused host composition tests cover authentication, one-to-one replacement, stable ordering, title reconciliation, retained directories, and identity rejection. Client runtime tests cover absolute deep-link parsing, current-session override, exact target selection, and waiting without cross-project fallback.

The keyless Linux Loader fixture exercises source read/search/edit/commit and diff alongside synthetic private-state and parent-environment canaries, including workspace symlinks, late unsafe tools, a shadowed allowed tool, exit status and cancellation. The preset fixture verifies the exact two-tool schema and absence of implicit instruction content; provider/model execution is a separate acceptance gate. On the tested Linux ABI 4 kernel, confined Rust fmt/clippy/test, Python/uv and an offline pnpm local-package install pass. Bun 1.3.11 run/install fail with `CouldntReadCurrentDirectory`/`StackOverflow`, while the matched unconfined control passes; Bun and full Forge application checks remain unsupported/unverified acceptance gates without expanding filesystem grants.

## Repository publication

The Code process keeps the Forgejo service credential outside model tools. Source Git preflight shares the confined command boundary because an editable clean filter can execute during a status check before approval; the Linux fixture verifies that such a filter cannot open synthetic private state. Authenticated catalog synchronization persists the repository binding separately from editable Git metadata. The approval-bound `forge_push_branch` operation selects the current committed development branch from the calling Session workspace, then pushes that exact commit through a temporary bare Git directory. This retains the object store without trusting local hooks, helpers, push URLs, or URL rewrites. Normal shell commands remain responsible for edits, tests, diffs, and commits; Forgejo remains responsible for review. Returning a general Git credential helper was rejected because it would disclose the broader service token to workspace commands.
