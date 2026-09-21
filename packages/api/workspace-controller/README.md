---
description: "Host and Client workspace control: mutate workspace navigation and follow its complete projection."
kind: "package-reference"
---
# Workspace Controller

## Summary

`@deepseek-ai/dsh-api-workspace-controller` owns the Host `ctx.workspaceController` service and the generated Client `ctx.remote.workspace` namespace. Its Remote methods resolve paths, create, rename, remove, and reorder Workspaces, reorder Sessions within a Workspace, archive Sessions from Workspace navigation, and follow the complete Workspace projection. Use it through API Gateway when a Client must change or follow Workspace navigation. The package also owns `ctx.directoryPickerController` and the generated `ctx.remote.directoryPicker` namespace, because the directory-picking seam it carries is abstract and never a Loader entry of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Host controller serializes mutations whose correctness depends on current registry state and throws `RemoteError` with a stable `workspace/*` or `directory-picker/*` code for expected failures. Its `follow()` stream synchronously attaches to durable Workspace changes, emits one complete baseline first, then emits ordered `upsert`, `remove`, `order`, and `archived` increments. A reconnect starts another generation with a replacement baseline, so consumers do not depend on receiving every increment while disconnected.

`resolveByPath({ path })` reads the current registration after Host-owned canonicalization, returning `{ workspace: null }` for an existing unregistered path. It never registers directories or changes order. Relative, missing or unreadable paths fail with `workspace/lookup-failed`; a failure must not be interpreted as absence. Provisional entities from unfinished registration writes are excluded.

The Client facade `resolveByPath(input, signal?)` returns the current `WorkspaceView` or `null` and exposes failures as `WorkspaceResolveError`. Its caller owns cancellation. Lookup replies never update the followed list, so a delayed response cannot restore a removed row or replace newer state. A match identifies the current registration, not the outcome of an earlier create request: path aliases can change and re-registration uses another identity. An absent result does not authorize retrying an uncertain mutation.

The Client entry provides `ClientWorkspaceModel` and `createWorkspaceStateStream()`. The model owns Workspace rows, registry order, archived Session ids, unary mutation echoes, and stream/unary race resolution. A newer Host row wins by `updatedAt`; a committed stream order outranks an older unary response; a removed Workspace id cannot be resurrected by delayed data. The package exposes framework-neutral snapshots and subscriptions, leaving navigation policy and React hooks to the UI owner. The [portable application facade](../remotes/README.md#portable-client) exports this same model and its Cordis installer for native and shell-owned compositions, preserving each host's separate state and stream lifecycle.

-----

<a id="model-experience"></a>
## Model Experience

None, as Workspace organization is browser and Host control state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; Workspace mutations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `follow()` replaces the whole projection after reconnect and has no durable cursor or incremental catch-up protocol.
- Process-local deletion markers prevent delayed data from reviving a removed Workspace only for the lifetime of the Client model.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Workspace Registry owns persistence; every stream generation is a full projection.
