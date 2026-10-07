---
description: "Session Info Remote: one point-in-time snapshot of a Session's identity, Workspace, execution environment, and effective command-authorization policy, read by the Web client's Info view."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-info

## Summary

`dsh-session-info` answers one question for the Web GUI: what is this Session, where is it running, and what may it do? Its single Remote method, `sessionInfo.read({ sessionId })`, assembles a point-in-time snapshot from the services that already own each fact — the Session header, the registered projection units (`title`, `summary`, `agentPreset`, `modelSelection`, `sessionStats`, `permissions`), the sandbox policy, the approval service, the Workspace registry, and the Host process. Every fact whose owner is not composed degrades to an explicit `null` rather than a fabricated value, and a Session that is not live on the Host answers `session-unavailable`.

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

### Reading the snapshot

`sessionInfo.read` is a pure read: it appends no Session event, mutates no policy, and writes no file. It answers `session-unavailable` only when the Session is absent from the live registry. A field with no owner — no sandbox policy service, no approval service, no Workspace registration, no permission projection — is `null`, so a consumer distinguishes "not composed" from "composed and set". An absent summary is likewise an explicit `null`, distinguishable from an empty-string summary, before one lands. The environment identity is the one fact read from the Session's live execution providers rather than a recorded projection: it is `null` when no world can be observed, and it is process-local, so equal ids prove two Sessions share an execution world on this Host while a restarted Host or recreated container names a new one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`SessionInfoService` extends `TypertRemoteService`, so its `read` method is a direct Remote endpoint under the `sessionInfo` namespace. It injects only `sessions` and `sessionProjections`; the sandbox policy, approval service, and Workspace registry are optional peers read through `ctx.get()`, because a deployment may compose the Info capability without any one of them. The projection cut is taken once, synchronously, through `ctx.sessionProjections.snapshot(session, keys)`, so every projection-derived field reflects the same log position.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [api-remotes](../../api/remotes/README.md) — the Client Remote assembly that mounts the generated `sessionInfo` namespace.
- [ui-session-info](../../client/ui-session-info/README.md) — the Info conversation-view tab that renders this reading.
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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The spec suite builds a Cordis bench with scripted `sessions` and `sessionProjections` services plus optional `sandboxPolicy`, `approval`, and `workspaceRegistry` peers, so it asserts the assembled snapshot, the explicit null degradation, and the `session-unavailable` answer without booting a full composition.

</details>

**Runtime invariant:** No companion is published. This package owns one Remote method and reads state another package owns, so it has no independent relationship to assert.
