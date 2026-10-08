---
description: "Info and Prompt conversation view tabs: the Session's conversation summary, identity, workspace, execution environment, effective command-authorization policy, OpenRouter spend, and estimated USD cost, plus the model-visible system prompt and full tool catalog, read from the Host sessionInfo and openrouterSpend Remotes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-info

## Summary

Open **Info** to inspect a Session's summary, identity, workspace, execution environment, command permissions, and OpenRouter spend. Open **Prompt** to inspect its logged system prompt and tool catalog, search descriptions and parameters, and expand parameter rows or raw JSON Schema. Each tab reads its own Remote on opening and on **Refresh**. Missing facts and failed reads have explicit locale-owned messages; a failed spend read affects only the spend block. The views hold no credentials and use no polling timers.

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

Open a Session's conversation view and select the **Info** tab (order 20, after Chat and Trajectory). The tab reads on first open through the generated `sessionInfo` and `openrouterSpend` Remote namespaces, renders the reading, and offers a **Refresh** button in its toolbar, beside the read time, that re-reads both at any time — in every state, including loading and failure. The summary and spend blocks span the view; the Session, Workspace, Environment, and Command-authorization cards occupy at most two columns and stack in narrow conversation panes. Fact labels and values align in each card, stacking when space is tight; long IDs and paths wrap without being shortened. The key usage and session estimate form separate spend columns when space allows, and the estimate displays its model and provider on separate lines.

Select the **Prompt** tab (order 30, after Info) for the model-visible prompt state. It reads `sessionInfo.readPrompt`, renders the system prompt in a scrollable code surface with its line and character figures and the route it was assembled for, and lists every tool as a card. Each card states the tool's parameter count, its description, and two disclosures: the declared parameter rows (name, declared type, required marker, and description) and the raw JSON Schema. The search box filters the cards by tool name, description, or parameter and reports the matches both in the count beside it and inside the system-prompt block; the Refresh button re-reads the same way.

### Reading the view

Every fact whose owner is not composed in the deployment is shown through the locale-owned unavailable wording rather than a fabricated value: no accepted conversation summary, no registered Workspace, no composed sandbox policy, no approval service, or no permission projection each render their own explicit absence. Policy values are shown as their machine keys (`read-only`, `workspace-write`, `danger-full-access`, `ask`, `never`, and the preset key) because they are product concepts the `/permission` command already names. The reading's read time is shown in the view toolbar. The summary block leads the view and shows the Session's latest accepted summary text, or the stated absence when the Session has none.

Each spend row labels its period and shows the amount through the single shared money formatter (en-US, two to four fraction digits, locale-owned unit wording). Separate locale-owned rows show the configured limit and its remaining headroom. A key with no configured limit shows the same locale-owned unlimited wording in both rows instead of fabricating an amount. A free-tier key carries a marker beside its label. The session block names the routed model and provider, then shows the estimated USD cost — or an explicit statement that the model has no OpenRouter catalog price, in which case no zero is fabricated. Every failure state shows its locale-owned reason without rendering Host or carrier diagnostics.

A Session with no system prompt on its surface, or with no logged request header yet, states those absences explicitly instead of showing an empty surface. A parameter whose schema declares no type renders the locale-owned untyped wording; a tool whose schema declares no properties states that it takes no parameters rather than showing an empty disclosure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin registers two localized `conversation.view` entries (id `info` and id `prompt`) through `ctx.slots.inject()`, so each follows declaration, redeclaration, and teardown of the slot. The Info entry declares a per-Session store whose state carries two independently settled readings — the primary `sessionInfo` reading and the nested `openrouterSpend` reading — and an inject face of two callbacks, `loadInfo` and `loadSpend`. The Prompt entry declares its own store with one reading and one callback, `loadPrompt`, so opening one tab never triggers the other's Remote. The framework bakes each store's `actions` into its inject factory; each callback aborts its own source's in-flight read with a private `AbortController`, marks that source loading, and dispatches the result: a carrier-level Remote failure folds into the read's `session-unavailable` reason (or the spend `unreachable` reason) with its message, a Host business failure carries its stated reason verbatim, and an aborted read dispatches nothing. Each view reads its store through the framework selector seat, triggers its callbacks on mount, and re-triggers them from the Refresh button; the Prompt view also owns its search query as local state and derives the filtered catalog from it.

### Registration

`apply` registers the `sessionInfo` dictionary namespace, mints both store handles once, and injects two entries: id `info`, order 20, and id `prompt`, order 30, each with a locale-owned label, its store seat, and its callback face. The Host Loader half is inert.

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

These limits define the reach of the views; they are current package constraints.

- **No background polling** — each view reads when it opens and on explicit refresh only; it runs no interval, so the facts shown are as fresh as the last read of that Session's view instance.
- **Repository state is not shown** — the Environment block reports host process facts, not the workspace's version-control state (branch, commit, dirty files); no such fact is exposed to the client today.
- **Credentials never reach the browser** — the OpenRouter key stays Host-side; the Remotes carry only amounts, the limit, the session estimate, and non-secret host facts.
- **In-flight reads are not disposed with the view** — the slot API gives the inject closure no disposer, so closing the tab or unloading the plugin does not abort a read already in flight; a read that settles after a newer read began is ignored by its stale controller check, and a read settling after the store instance is released writes to an unsubscribed instance.
- **The Prompt view presents a reading, not a live assembly** — it shows the last logged system prompt and request tool catalog, so a tool registered since that request appears only after the next one is logged, and the prompt is shown as its rendered text rather than as its contributing sections. Searching filters the catalog and counts prompt occurrences; it does not highlight, reorder, or paginate.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The spec suite feeds each view its composed seats directly (store instance plus `makeTranslate`) and drives the plugin wiring through a Cordis bench with scripted `remote.sessionInfo` and `remote.openrouterSpend` faces, so neither the conversation view owner nor the wire is required. The keyless owner-local [`info-view.expected.md`](tests/info-view.expected.md) captures configured and remaining limits, priced and unpriceable sessions, and a failure state. Fixture amounts keep a non-zero last digit so the no-fabricated-zero assertions stay exact. The Prompt view is pinned by its own view and pure-helper suites: the prompt figures, the parameter rows over a schema that declares no type and one that declares none at all, the search filter and prompt match count, the absence states, and both abort rails — resolved-late and rejected-late — of its read.

</details>

**Runtime invariant:** No companion is published. This package owns two conversation view contributions and one dictionary namespace.
