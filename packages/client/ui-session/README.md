---
description: "React and Slot adapters for Session Controller lists, interaction state, and per-session context."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-session

## Summary

React and Slot adapter for Session Controller state. It contributes Session list and pending-interaction hooks at root scope, materializes per-Session hooks and props, and owns the standard `SessionProvider` rendering behavior without taking ownership of Session transport or lifecycle state. Use it when a browser feature needs Session state through standard React props and hooks.

## Table of Contents

- [Portable interactions](#portable-interactions)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Portable interactions

Native clients import `PendingInteractions` from `@deepseek-ai/dsh-client-ui-session/client/portable`. Each Host owns one registry. Its stable observable source exposes the effective request per Session; each domain registers with its contributing Cordis context and precedence. The browser adapter uses the same owner. Higher precedence wins, equal precedence follows contribution traversal order, and hidden changes preserve snapshot identity.

Domain disposal withdraws its requests before delegating and awaiting their owners. A released publisher rejects new requests. Concrete request handlers, native controls and device transport belong to their own consumers. Shared interaction declarations extend the type-only `@deepseek-ai/dsh-client-ui-session/client/types` entry; this retains one identity across browser and portable imports.

<a id="model-experience"></a>
## Model Experience

None, as this package adapts browser-side Session state and registers nothing model-facing.

#### KV Cache effect

None; Session selectors and Slot scopes do not assemble model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Pending interactions are process-local projections** — the owning Remote waterfall must replay an outstanding request after a browser reconnect.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The adapter materialization path enforces Session binding consistency.
