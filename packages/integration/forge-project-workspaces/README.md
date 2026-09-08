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

Develop through the existing shell tools: create a development branch, edit files, run the project checks, inspect `git diff`, and commit. Then call `forge_push_branch`; its success reports the independently verified remote commit. Open that branch in Forgejo to request review. Git author identity remains the developer's explicit commit configuration.

Publication runs from temporary clean Git metadata with access to the selected clone's object store. Repository hooks, helpers, push URLs, and URL rewrites cannot affect the credential-bearing process. HTTP(S) is the only allowed transport, redirects are disabled, and output/errors never include remote diagnostics. `gitPushTimeoutMs` bounds each command (default 60 seconds); cancellation terminates its POSIX process group. Temporary metadata is removed after completion. Tools and approval services are required when publication is enabled.

## Model Experience

### Repository publication tool

#### What the model sees

A configured Forge Web deployment adds the stable no-argument [forge_push_branch tool schema](../../../docs/tool-catalog.md#forge_push_branch) to the model's tools. Approval requests and decisions are logged through the normal approval service, and tool results identify the verified repository, branch, and commit. The token never enters the model request or Session log.

#### Token effect

The fixed tool schema is present in each model request; a publication call adds a bounded repository, branch, and commit result to the retained transcript.

#### KV Cache effect

Enabling publication adds one stable tool schema. The project selection and token do not change that schema.

## Known Limitations and Deferred Work

- **The Web process executes in the mounted workspace world** — this plugin does not provide filesystem, process, network, credential, lifetime, or cleanup isolation. Forge's executor provider owns that later security boundary.
- **Existing repositories are not refreshed** — reconciliation preserves local edits and branches by leaving an existing `.git` directory untouched.
- **Removed directories are retained** — replacement removes only the Harness registration so an accidental catalog omission cannot delete source or Session data.

Publication is available on POSIX hosts. It requires the managed clone itself; linked Git worktrees and symlinked Git metadata are refused.
