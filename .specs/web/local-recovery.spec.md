---
id: REQ:web/local-recovery
type: requirement
status: accepted
level: MUST
summary: Keep a fixed local Web address recoverable through an independent manual fallback proxy.
owners: [carlo]
refines: []
categorized_under: []
---

# Local development recovery

:::{requirement id="local-recovery" level="MUST"}
- {#c-control} A repository development proxy MUST keep its loopback listener and recovery controls available when the Harness backend fails, and MUST forward HTTP and WebSocket traffic through the selected backend without automatically retrying mutating requests.
- {#c-good} A last-good record MUST identify a committed build explicitly confirmed by the operator to have edited code. Its retained build and dependencies MUST survive edits, rebuilds, or startup failures in the development checkout. Failed preparation MUST preserve the existing record.
- {#c-switch} Explicit controls MUST select current or last-good, stop and await the previous backend before starting another against the same Harness home, and never infer task success or automatically switch after a failed task.
- {#c-access} The listener MUST remain on loopback for exposure through an existing trusted proxy such as Tailscale. Recovery mutations MUST require a private capability and reject cross-origin browser requests. Authenticated same-origin browser form submissions MUST reach the selected recovery action without accepting opaque origins. Forwarding MUST preserve Harness authentication and the original request authority.
- {#c-evidence} Tests MUST exercise failed startup, manual recovery, streaming and WebSocket forwarding, rejected control requests, retained-build provenance, and process cleanup. Documentation MUST state that switching neither retries tasks nor downgrades persisted data.
:::
