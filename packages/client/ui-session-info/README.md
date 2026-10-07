---
description: "Info conversation view tab: the Session's conversation summary, identity, workspace, execution environment, and effective command-authorization policy plus the OpenRouter key's spend and the session's estimated USD cost, read from the Host sessionInfo and openrouterSpend Remotes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-info

## Summary

The **Info** tab is the session's general information view. It reads the Host's `sessionInfo.read` snapshot and renders five sectioned blocks — **Conversation summary** (the latest accepted summary, or an explicit absence), **Session**, **Workspace**, **Environment**, and **Command authorization** — then appends a **Spend** block from the Host's separate `openrouterSpend.read` reading. Each Remote renders an in-flight state, the settled reading, and one distinct stated failure per Host-reported reason; the spend read settles independently, so its failure degrades only the spend block while a session-info failure fails the view. The view owns no timers and holds no credentials. The **Environment** block reports the verified execution placement, a process-local environment id — two Sessions showing the same id run in the same execution world on the Host — the Host platform and architecture, OS release, Node version, and home directory.

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

Open a Session's conversation view and select the **Info** tab (order 20, after Chat and Trajectory). The tab reads on first open through the generated `sessionInfo` and `openrouterSpend` Remote namespaces, renders the reading, and offers a **Refresh** button that re-reads both at any time — in every state, including loading and failure.

### Reading the view

Every fact whose owner is not composed in the deployment is shown through the locale-owned unavailable wording rather than a fabricated value: no accepted conversation summary, no registered Workspace, no composed sandbox policy, no approval service, or no permission projection each render their own explicit absence. Policy values are shown as their machine keys (`read-only`, `workspace-write`, `danger-full-access`, `ask`, `never`, and the preset key) because they are product concepts the `/permission` command already names. The reading's read time is shown under the blocks. The summary block leads the view and shows the Session's latest accepted summary text, or the stated absence when the Session has none.

Each spend row labels its period and shows the amount through the single shared money formatter (en-US, two to four fraction digits, locale-owned unit wording). Separate locale-owned rows show the configured limit and its remaining headroom. A key with no configured limit shows the same locale-owned unlimited wording in both rows instead of fabricating an amount. A free-tier key carries a marker beside its label. The session block names the routed model and provider, then shows the estimated USD cost — or an explicit statement that the model has no OpenRouter catalog price, in which case no zero is fabricated. Every failure state shows its locale-owned reason without rendering Host or carrier diagnostics.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin registers one localized `conversation.view` entry (id `info`) through `ctx.slots.inject()`, so it follows declaration, redeclaration, and teardown of the slot. The entry declares a per-Session store whose state carries two independently settled readings — the primary `sessionInfo` reading and the nested `openrouterSpend` reading — and an inject face of two callbacks, `loadInfo` and `loadSpend`. The framework bakes the store's `actions` into the inject factory; each callback aborts its own source's in-flight read with a private `AbortController`, marks that source loading, and dispatches the result: a carrier-level Remote failure folds into the info `session-unavailable` reason (or the spend `unreachable` reason) with its message, a Host business failure carries its stated reason verbatim, and an aborted read dispatches nothing. The view reads the store through the framework selector seat, triggers both callbacks on mount, and re-triggers them from the Refresh button; it performs no other mutation.

### Registration

`apply` registers the `sessionInfo` dictionary namespace, mints the store handle once, and injects one entry: id `info`, order 20, locale-owned label, the store seat, and the two-callback inject face. The Host Loader half is inert.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the slot the tab registers into and the Remote seams behind it.

- [ui-conversation](../ui-conversation/README.md) — the conversation view owner that declares the `conversation.view` slot.
- [api-remotes](../../api/remotes/README.md) — the Client Remote assembly that mounts the generated `sessionInfo` and `openrouterSpend` namespaces.
- [session-info](../../api/session-info/README.md) — the Host capability that assembles the Session, environment, and policy snapshot.
- [openrouter-spend](../../llm/openrouter-spend/README.md) — the Host capability that reads the OpenRouter key usage and prices the session.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the reach of the Info view; they are current package constraints.

- **No background polling** — the view reads when it opens and on explicit refresh only; it runs no interval, so the facts shown are as fresh as the last read of that Session's view instance.
- **Repository state is not shown** — the Environment block reports host process facts, not the workspace's version-control state (branch, commit, dirty files); no such fact is exposed to the client today.
- **Credentials never reach the browser** — the OpenRouter key stays Host-side; the Remotes carry only amounts, the limit, the session estimate, and non-secret host facts.
- **In-flight reads are not disposed with the view** — the slot API gives the inject closure no disposer, so closing the tab or unloading the plugin does not abort a read already in flight; a read that settles after a newer read began is ignored by its stale controller check, and a read settling after the store instance is released writes to an unsubscribed instance.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The spec suite feeds the view its composed seats directly (store instance plus `makeTranslate`) and drives the plugin wiring through a Cordis bench with scripted `remote.sessionInfo` and `remote.openrouterSpend` faces, so neither the conversation view owner nor the wire is required. The keyless owner-local [`info-view.expected.md`](tests/info-view.expected.md) captures configured and remaining limits, priced and unpriceable sessions, and a failure state. Fixture amounts keep a non-zero last digit so the no-fabricated-zero assertions stay exact.

</details>

**Runtime invariant:** No companion is published. This package owns one conversation view contribution and one dictionary namespace.
