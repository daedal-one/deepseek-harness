---
description: "Spend conversation view tab: the OpenRouter key's total, daily, weekly, and monthly spend with its remaining limit, plus the current session's estimated USD cost, read from the Host openrouterSpend Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-openrouter-spend

## Summary

The **Spend** tab is a conversation view that answers one question — what has this OpenRouter key spent, and what is this session costing? It projects the Host's `openrouterSpend.read` reading for the current Session into two blocks: the key's spend rows (total, daily, weekly, monthly, and the remaining limit when one is set, with a free-tier marker) and the session estimate for the routed model. The tab renders an in-flight state, the settled reading, and one distinct, stated failure state per Host-reported reason (unconfigured, unauthorized, rate-limited, unreachable, malformed response). The view owns no timers and holds no credentials; it reads when it opens and when the user asks it to.

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

Open a Session's conversation view and select the **Spend** tab (order 20, after Chat and Trajectory). The tab reads on first open through the generated `openrouterSpend` Remote namespace, renders the reading, and offers a **Refresh** button that re-reads at any time — in every state, including loading and failure.

### Reading the view

Each spend row labels its period and shows the amount through the single shared money formatter (en-US, two to four fraction digits, locale-owned unit wording). A key with no configured limit shows the locale "no limit set" wording in the limit row instead of an amount. A free-tier key carries a marker beside its label. The session block names the routed model and provider, then shows the estimated USD cost — or an explicit statement that the model has no OpenRouter catalog price, in which case no zero is fabricated. The reading's fetch time is shown under the blocks, and every failure state shows its stated reason with the Host diagnostic detail.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin registers one localized `conversation.view` entry (id `spend`) through `ctx.slots.inject()`, so it follows declaration, redeclaration, and teardown of the slot. The entry declares a per-Session store (`createSpendStore()`, a `loading` / `ready` / `failed` union) and an inject face of one callback, `load`. The framework bakes the store's `actions` into the inject factory; `load` aborts the instance's in-flight read with an `AbortController`, marks the store loading, and dispatches the result — a carrier-level Remote failure folds into `unreachable` with its message, the Host's business failure carries one of the five reasons verbatim, and an aborted read dispatches nothing. The view reads the store through the framework selector seat, triggers `load()` on mount, and re-triggers it from the Refresh button; it performs no other mutation.

### Registration

`apply` registers the `spend` dictionary namespace, mints the store handle once, and injects one entry: id `spend`, order 20, locale-owned label, the store seat, and the `load` inject face. The Host Loader half is inert.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the slot the tab registers into and the Remote seam behind it.

- [ui-conversation](../ui-conversation/README.md) — the conversation view owner that declares the `conversation.view` slot.
- [api-remotes](../../api/remotes/README.md) — the Client Remote assembly that mounts the generated `openrouterSpend` namespace.
- [openrouter-spend](../../llm/openrouter-spend/README.md) — the Host capability that reads the OpenRouter key usage and prices the session.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the freshness and reach of the spend view; they are current package constraints.

- **No background polling** — the view reads when it opens and on explicit refresh only; it runs no interval, so spend shown is as fresh as the last read of that Session's view instance.
- **Unpriceable sessions are explicit, not zero** — when the routed model has no OpenRouter catalog price, the session estimate shows the unpriceable wording rather than any amount.
- **Credentials never reach the browser** — the OpenRouter key stays Host-side; the Remote carries only amounts, the limit, and the session estimate.
- **In-flight reads are not disposed with the view** — the slot API gives the inject closure no disposer, so closing the tab or unloading the plugin does not abort a read already in flight; a read that settles after a newer read began is ignored by its stale controller check, and a read settling after the store instance is released writes to an unsubscribed instance.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The spec suite feeds the view its composed seats directly (store instance plus `makeTranslate`) and drives the plugin wiring through a Cordis bench with a scripted `remote.openrouterSpend` face, so neither the conversation view owner nor the wire is required. Fixture amounts keep a non-zero last digit so the no-fabricated-zero assertions stay exact.

</details>

**Runtime invariant:** No companion is published. This package owns one conversation view contribution and one dictionary namespace.
