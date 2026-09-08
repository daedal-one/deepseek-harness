# `@deepseek-ai/dsh-forge-project-workspaces`

This Web-host plugin accepts the Forge Hub's authenticated project catalog and reconciles it into the Harness Workspace registry. Forge remains authoritative for project identity and repository ownership; the Harness stores only the derived directory registrations and sessions.

## Runtime contract

`PUT /forge/v1/projects/sync` replaces the complete managed catalog. Every row must carry `project_id: PROJECT:<slug>`, the same validated slug, a display title, and an optional `owner/repository` Forgejo name. The route creates or reuses `/workspaces/forge/<slug>`, clones a named repository only when that directory has no Git checkout, rejects an existing checkout linked to a different repository, registers the path, restores Forge order and title, and unregisters managed rows absent from the replacement. Unregistration never deletes the directory or Session logs.

`GET /forge/v1/projects/sync` reads persisted managed registrations without cloning, adopting directories, refreshing Git, or changing registry membership. It survives process restart and verifies each exact canonical path and configured Forgejo origin before returning its repository identity. The Hub joins those rows against its own complete project roster; an unsynchronized project stays unavailable while established projects remain openable.

`gitReadTimeoutMs` bounds each local Git metadata read (default 5 seconds); `maxRequestBytes` also bounds its captured output. Neither read receives application credentials.

The bearer token protects both methods. Repository credentials enter controlled Git network commands only through the child environment, never the URL, workspace files, tool arguments, or response. Concurrent replacements serialize; a partial materialization failure returns an error and a later identical request reconciles the remaining state idempotently.

The Forge deployment supplies this package through its released DeepSeek Harness image and mounts it beside the Web profile. The Hub selects a reconciled project with the client runtime's exact `?workspace=` deep link. The Workspace browser remains mounted for managed Session history, while directory adoption is disabled and public create, rename, delete, and reorder RPCs are rejected. This authenticated replacement remains the only project-roster writer exposed to operators.

## Repository publication

Set `publicationStateFile` to an absolute deployment-owned path outside managed workspaces to enable `forge_push_branch`. Authenticated catalog replacements persist owner/repository bindings there; existing installations must synchronize once before publication is available. Editing `.git/config` never changes publication authority. The tool requires the calling Session to belong to its exact persisted Workspace, a clean committed `codex/` or `forge/` branch, and explicit approval of the selected repository, branch, and commit. An unknown or selected remote default branch is refused; Forgejo enforces additional branch-protection rules. Force updates, tags, deletion, alternate destinations, and model-supplied Git arguments are unavailable.

With confidential mode enabled, develop through `forge_shell`: create a development branch, edit files, run the project checks, inspect `git diff`, and commit. Then call `forge_push_branch`; its success reports the independently verified remote commit. Open that branch in Forgejo to request review. Git author identity remains the developer's explicit commit configuration.

With confidential mode enabled, every source-repository Git preflight also runs under Landlock: repository-defined clean filters cannot turn a status check into an unconfined command. Publication runs from temporary clean Git metadata with access to the selected clone's object store. Repository hooks, helpers, push URLs, and URL rewrites cannot affect the credential-bearing process. HTTP(S) is the only allowed transport, redirects are disabled, and output/errors never include remote diagnostics. `gitPushTimeoutMs` bounds each command (default 60 seconds); cancellation terminates its POSIX process group. Temporary metadata is removed after completion. Tools and approval services are required when publication is enabled.

## Confined Code commands

Forge Web enables `confidentialTools` and supplies `toolReadRoots` containing immutable runtime directories and selected system files. Startup requires the confidential launcher probe (Landlock ABI 3 or newer plus enforced socket denial) and persisted publication bindings. `forge_shell` runs only in the calling Session's exact registered repository, grants read/write access to that repository and one private temporary directory, and clears the inherited environment. Direct paths and symlink aliases cannot read other projects, private Harness state, or parent process environments. Commands default to a 60-second deadline; optional `timeout_ms` accepts 1–600000 milliseconds for longer builds. Each command captures at most 256 KiB per output stream, reports its exit code, and removes its temporary directory after process-tree termination. Temporary caches do not survive a call; keep intended durable build artifacts in the repository.

`managedDirectoryPicker` supplies the Web host with a closed `forge-managed` picker capability: browsing, picking and directory creation remain unavailable while the host dependency stays satisfied.

The dedicated `presets/forge` root supplies a persona without automatic instruction-file readers. Configure the preset roster with only that immutable root and `includeUserRoot: false`; read repository instructions explicitly through `forge_shell`. The CLI preserves explicit deployment roots and retains its shipped defaults when none are supplied. A global monotonic guard rejects every tool except the owned `forge_shell` and `forge_push_branch` implementations, including late scoped replacements. Generic Harness configurations retain their existing tools and presets when confidential mode is omitted.

This boundary confines model command filesystem access and descendant process lifetime. The privileged Web process still owns its configured credentials; the feature does not isolate that host process. Confined commands cannot create network endpoints or connect to the parent Web service, including over loopback or Unix sockets. Dependency installation requires prepopulated offline caches or a separately trusted preparation path. Browser-origin authentication and deployment network policy remain separate controls. Persistent terminals, background jobs, native file/search tools, user presets, and subagent/workflow tools are unavailable in this Forge composition.

## Model Experience

### Repository publication tool

#### What the model sees

A configured Forge Web deployment presents `forge_shell` for commands and the stable no-argument [forge_push_branch tool schema](../../../docs/tool-catalog.md#forge_push_branch) to the model's tools. Approval requests and decisions are logged through the normal approval service, and tool results identify the verified repository, branch, and commit. The token never enters the model request or Session log.

#### Token effect

The two fixed tool schemas are present in each confidential-mode model request; a publication call adds a bounded repository, branch, and commit result to the retained transcript.

#### KV Cache effect

Enabling publication adds one stable tool schema; confidential mode adds the fixed command schema. The project selection and token do not change that schema.

## Known Limitations and Deferred Work

- **Confidential mode requires Linux enforcement** — other platforms, Landlock ABI below 3, or unavailable socket denial reject startup. The Web host process remains under deployment authority; only the declared model command boundary is confined.
- **Bun 1.3.11 is not supported inside the confined command boundary** — the keyless Linux fixture observes `CouldntReadCurrentDirectory` for TypeScript execution and `StackOverflow` while parsing the offline install manifest. The same commands pass without confinement; an explicit working directory does not fix them. Workspace ancestors and private process paths remain denied. Rust fmt/clippy/test, Python/uv, Git and an offline pnpm local-package install pass through the actual confined tool; complete Forge application checks remain a separate release gate.
- **Existing repositories are not refreshed** — reconciliation preserves local edits and branches by leaving an existing `.git` directory untouched.
- **Removed directories are retained** — replacement removes only the Harness registration so an accidental catalog omission cannot delete source or Session data.

Publication is available on POSIX hosts. It requires the managed clone itself; linked Git worktrees and symlinked Git metadata are refused.
