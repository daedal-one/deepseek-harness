# Agent Note: Host-wide Client history-detail retention

Status: implemented

## Problem

Resident Session objects outlive the selected conversation. A per-view or per-Session cache limit therefore cannot bound the combined hydrated results of a Host. Keeping a separate UI cache would also let its entries disagree with the shared event window and Chat projection.

## Decision

The Client Session manager owns one optional retention allowance for its Host. Session owns each exact hydration and the original compact entry. Accounting uses complete JSON UTF-16 code units so portable runtimes need no Node Buffer or browser encoding API; it is explicitly distinct from heap bytes and from the Host's encoded-byte hint. Oldest hydrations return to their exact compact entries through the existing event source. The Chat assembler observes the same replacement, so paging identities, Session events and tool-result authority remain in their original owners.

Oversized entries reject before eviction. This bounds retained exact results without presenting truncated data as a complete result. Transport allocation, in-flight reads, live events and the compact history window require separate bounds. The composition owner chooses the allowance; no value is embedded in Session behavior. Omission preserves the browser's existing hydration policy.

## Alternatives considered

**A cache per conversation view.** Resident Sessions and previously materialized Chat state can retain data after navigation.

**A per-Session allowance.** The aggregate grows with the number of opened Sessions.

**Count the Host's detail byte hint.** The Client must charge the exact accepted entry, including metadata, in its documented units.

**Silently truncate a large result.** A tool detail would appear complete while omitting authoritative content.

## Consequences

Evicted results need another explicit request. History replacement and disposal release accounting as well as hydrated references; synchronous eviction observers may replace a generation before a new hydration is published. The compiled conversation benchmark keeps Session and Chat alive, verifies all events and projected result content, and reports fresh-process retained heap after garbage collection. Those samples do not establish peak memory or installed-device acceptance. The [Session/conversation ownership decision](2026-08-20-client-session-conversation-ownership.md) remains authoritative for the broader projection ownership rules.
