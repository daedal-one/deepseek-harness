---
id: REQ:ui/poor-connection-resilience
type: requirement
status: accepted
level: MUST
summary: The Web application remains usable and recoverable across high-latency, low-bandwidth, and interrupted connections.
owners: [carlo]
refines:
  - REQ:ui/responsive-web-shell
categorized_under: []
---

# Poor-connection resilience

## Context

The Web application transfers the complete client-plugin graph and large unbounded conversation projections before the corresponding surface is usable. High round-trip latency amplifies the plugin request fan-out, low bandwidth makes a valid history response exceed the unary timeout, and reconnect replaces a readable transcript with another full-tail load.

:::{requirement id="poor-connection-resilience" level="MUST"}
- {#c-boot} A production Web boot MUST deliver the composed client-plugin registration graph through one content-addressed request, MUST negotiate Brotli or gzip for compressible bodies, and MUST allow unchanged content-addressed assets to load from the browser cache.
- {#c-history} An initial or earlier conversation-history response MUST enforce a configured byte bound over the complete serialized RPC response, MUST retain whole message groups, MUST return one explicitly marked oversized group when no bounded group fits, and MUST keep durable log fidelity while deferring full Tool-result detail until requested.
- {#c-settled-streams} A history projection MUST omit redundant settled Assistant stream chunks while retaining the evidence required for final content, usage, latency, retry, interruption, and trajectory reconstruction; live and interrupted output MUST remain complete.
- {#c-recovery} A failed conversation open MUST expose an explicit retry action, MUST classify transport timeout and network-unavailable failures separately from Host failures, and MUST recover without a page reload.
- {#c-reconnect} Reconnection MUST preserve an already rendered transcript, MUST reconcile from its last contiguous sequence when possible, and MUST replace it only after a bounded continuity repair succeeds.
- {#c-session-list} Session listing MUST use a real continuation cursor, MUST retain a requested current Session outside the first recency page, and MUST fetch another page only through an explicit client request.
- {#c-coalescing} Concurrent identical settings-description reads MUST share one in-flight request and MUST not retain a stale result after settlement or a settings mutation.
- {#c-security} The transport improvements MUST preserve the loopback-only server binding and the existing trusted-Host boundary; they MUST NOT add a public origin or service worker requirement.
- {#c-evidence} The assembled production application MUST have a deterministic poor-network lane that verifies request count, encoded transfer, bounded history, timeout recovery, warm-cache reuse, and transcript equivalence on a production-sized history.
:::
