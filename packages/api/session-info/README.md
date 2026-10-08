---
description: "Session Info Remote: one point-in-time snapshot of a Session's identity, Workspace, execution environment, and effective command-authorization policy, plus the model-visible prompt state in force for it, read by the Web client's Info and Prompt views."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-info

## Summary

Read a Session's identity, workspace, execution environment, command permissions, and logged prompt state from the Web client. `sessionInfo.read` returns the current information snapshot; `sessionInfo.readPrompt` returns the rendered system prompt and the latest logged tool catalog and model route. Missing service-owned facts are explicit `null` values. A Session absent from the live registry returns `session-unavailable`. Neither read changes the Session or its policies.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the Host row and call its Remote method from a Client that has mounted the generated `sessionInfo` namespace through [`dsh-api-remotes`](../../api/remotes/README.md):

The Client calls `ctx.remote.sessionInfo.read({ sessionId }, signal)`. It checks the outer RPC result's `ok` field and the inner reading's `ok` field before rendering `result.value.value`.

The shipped Web profile mounts this package as the `session-info` Host row, and the [Info view](../../client/ui-session-info/README.md) renders the reading. The snapshot carries the **session** block (id, title, preset, latest durable model route, working directory, turn and step counts), the **summary** (the latest accepted conversation summary, or null before one lands), **workspace** (the registered Workspace accounting the Session, or null), **environment** (verified execution placement, a process-local identity of the execution world the Session runs in, plus Host platform, architecture, OS release, Node version, and home directory), and **policies** (effective and default sandbox mode, the resolved `workspace-write` root, effective and default approval policy, and the effective permission preset with its declared description). The reading's timestamp is `readAt`.

The same client calls `ctx.remote.sessionInfo.readPrompt({ sessionId }, signal)` for the [Prompt view](../../client/ui-session-info/README.md). That reading carries the rendered **system prompt** in force (empty when the surface holds none), the **tools** of the latest request header as `{ name, description, parameters }`, the **model** route recorded on that header, and its own `readAt`.

### Reading the snapshot

`sessionInfo.read` is a pure read: it appends no Session event, mutates no policy, and writes no file. It answers `session-unavailable` only when the Session is absent from the live registry. A field with no owner — no sandbox policy service, no approval service, no Workspace registration, no permission projection — is `null`, so a consumer distinguishes "not composed" from "composed and set". An absent summary is likewise an explicit `null`, distinguishable from an empty-string summary, before one lands. The environment identity is the one fact read from the Session's live execution providers rather than a recorded projection: it is `null` when no world can be observed, and it is process-local, so equal ids prove two Sessions share an execution world on this Host while a restarted Host or recreated container names a new one.

`sessionInfo.readPrompt` is likewise a pure read. Its facts come from the Session's own folds rather than from a second prompt assembly: the effective system prompt is the last system-role message of `Session.deriveMessages()` — the node a route with `'in-history'` system-prompt updates reads as authoritative — and the tools and model route are `Session.requestHeader()`. An empty system prompt and an empty tool list are stated facts, not an absent reading: an empty prompt records that the surface holds none, and an empty tool list records that no request header has been logged yet. A non-text block in a system message renders through its JSON form rather than disappearing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`SessionInfoService` extends `TypertRemoteService`, so its `read` and `readPrompt` methods are direct Remote endpoints under the `sessionInfo` namespace. It injects only `sessions` and `sessionProjections`; the sandbox policy, approval service, and Workspace registry are optional peers read through `ctx.get()`, because a deployment may compose the Info capability without any one of them. The projection cut is taken once, synchronously, through `ctx.sessionProjections.snapshot(session, keys)`, so every projection-derived field reflects the same log position. `readPrompt` reads no projection and no peer: `Session.deriveMessages()` and `Session.requestHeader()` are the Session's own incrementally cached folds, so a per-step read costs only the events appended since the last one.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [api-remotes](../../api/remotes/README.md) — the Client Remote assembly that mounts the generated `sessionInfo` namespace.
- [ui-session-info](../../client/ui-session-info/README.md) — the Info and Prompt conversation-view tabs that render these readings.
- [openrouter-spend](../../llm/openrouter-spend/README.md) — the Host capability that prices the session block.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a read-only projection of already-logged Session state and Host facts, and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the reach of the reading; they are current package constraints.

- **Host facts only, no repository state** — the snapshot reports the Host platform, architecture, OS release, Node version, and home directory, but it does not inspect the Session workspace for version-control state (branch, commit, or dirty files); no such fact is recorded in the Session log or owned by a composed service today.
- **One Session at a time** — the Remote method is addressed by `sessionId` and reads one live Session; it is not a Host inventory, and a Session that is not live answers `session-unavailable` rather than a persisted summary.
- **Policy is read, never changed** — the snapshot reports the effective sandbox mode, approval policy, and permission preset; switching any of them remains the `/permission` command's write path through [`dsh-permission-presets`](../../interaction/permission-presets/README.md).
- **The prompt reading is the last logged request, not a live re-assembly** — `readPrompt` reports what the Session's log holds, so a tool registered after the latest request header does not appear until the next request is logged, and the reading never re-runs provider callbacks or the `system-prompt/assemble` waterfall. It reports the rendered prompt text, not the contributing section names: a section breakdown exists only inside a live assembly, which this read deliberately does not perform.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The spec suite builds a Cordis bench with scripted `sessions` and `sessionProjections` services plus optional `sandboxPolicy`, `approval`, and `workspaceRegistry` peers, so it asserts the assembled snapshot, the explicit null degradation, and the `session-unavailable` answer without booting a full composition. The same bench answers the prompt reads through the Session stub's own `deriveMessages` and `requestHeader` folds, which pins the effective-system-prompt rule (the last system node), the non-text-block rendering, the empty surface, and the aborted request.

</details>

**Runtime invariant:** No companion is published. This package owns two Remote reads and reads state another package owns, so it has no independent relationship to assert.
