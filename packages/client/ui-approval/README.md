---
description: "Browser approval UI that answers Host permission requests through the scoped interaction path."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-approval

## Summary

Browser approval presentation over the Agent-scoped Remote Event waterfall. The plugin publishes each pending request through `ctx.uiSession`, takes over the Conversation composer, optionally renders correlated Tool detail, and returns the user's decision to the waiting Host request. Use it when a browser must collect approval for a waiting Host operation.

## Table of Contents

- [Portable requests](#portable-requests)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Portable requests

The `@deepseek-ai/dsh-client-ui-approval/client/portable` entry exposes `PendingApproval` and `registerApprovalRequests` without React or Slots. Supply the generated Remote service, Session scope lookup and a pending-domain registrar owned by the same Cordis fiber. The shared consumer publishes approval requests at precedence zero and returns an allow-once or rejection decision to the Host. Requests without a Session scope delegate to the next listener.

Request cancellation removes the abort listener and pending value. Domain disposal withdraws the request before delegating and waits for the next listener to finish. Failed publication settles and observes the carrier before propagating its error. The browser plugin uses this same consumer; native applications provide their own controls and consume the shared pending source.

<a id="model-experience"></a>
## Model Experience

None, as this package presents approval requests in the browser and registers nothing model-facing.

#### KV Cache effect

None; approval request and response rendering does not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The panel exposes transient decisions only** — it supports allow-once and reject; persistent permission policy remains owned by Host-side approval packages.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Registries own and observe the Remote listener and temporary Slot entry.
