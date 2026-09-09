# Agent Note: Bounded Web delivery on constrained connections

Status: implemented

## Problem

The production Web shell requires every independently served client plugin before the application becomes usable, but those content-addressed scripts are not cacheable and no HTTP response is compressed. A valid conversation can project several megabytes of settled stream chunks and Tool results into one unary history response, while the carrier aborts bounded calls after thirty seconds. Reconnect clears a readable transcript before paying that cost again, and session listing transfers every row before its presentation limit applies.

These costs make bandwidth and round-trip time correctness inputs: at 400 kbit/s, a multi-megabyte history response cannot reach the client before the fixed timeout even when the Host is healthy.

## Decision

The production graph carries revision-addressed bootstrap and application combo URLs. The Host caches the concatenated classic registration wrappers in memory without materializing them, and the browser loads each combo once before Loader activation; single-resource combo endpoints remain the HMR reload path. Hashed shell assets, graph bundles, and revision-addressed plugin files are immutable. Index HTML remains uncacheable. The static and API HTTP owners negotiate Brotli then gzip, preserve `Vary: Accept-Encoding`, and leave SSE, already encoded, incompressible, and tiny bodies untouched.

History is a bounded wire projection over the unchanged durable Session log. Settled Assistant steps retain their final message plus the first token evidence needed for latency and streamed-text classification; incomplete and interrupted steps retain every chunk. Tool-result history rows carry a valid minimal result plus a deferred-detail marker, while an exact-sequence detail RPC returns the complete event and presenter view when the user opens that Tool row. Page selection applies the configured byte bound to the serialized RPC envelope, removes oldest complete message groups until it fits, and returns one marked oversized group when the newest group cannot fit alone.

The client keeps an open transcript during connection-generation repair, stitches a bounded tail from its last contiguous sequence, and only replaces the window at a successful commit point. Initial failures distinguish timeout from network unavailability and expose a retry action. Session listing uses a stable recency cursor with a bounded page size and may add the requested restored Session outside that page; later pages are explicit. Settings-description calls share only their in-flight promise, so settlement and mutations cannot leave a hidden cache.

## Alternatives considered

**Raise the unary timeout.** A larger deadline hides one measured payload but leaves transfer proportional to conversation size, makes failures slower, and does not improve boot or reconnect responsiveness.

**Install a service worker for offline caching.** The retained iPhone endpoint is a plain HTTP tailnet address and therefore cannot depend on a secure-context-only worker. Ordinary immutable HTTP caching covers the content-addressed assets without changing the trust boundary.

**Activate plugins progressively.** The current application treats the composed graph as one UI and several plugins contribute required shell seats. Combo registration requests remove the per-plugin latency fan-out while preserving the existing all-active commit point; progressive activation remains unnecessary unless the measured production bundle misses the agreed budget.

**Rewrite or compact the durable Session log.** Raw chunks and Tool results are required for replay and model-history fidelity. The bounded projection changes only what the browser initially receives and retains an exact on-demand path to the original event.

**Cache `settings.describe` results.** A settled cache would need invalidation for external file edits and configuration-plane changes. In-flight sharing removes duplicate boot requests without inventing a second settings authority.

## Consequences

- The production graph reaches the browser through revision-addressed bootstrap and application combo requests, while HMR can still invalidate and fetch one plugin.
- Compression, cache policy, HEAD handling, encoding negotiation, and uncompressed streaming behavior have transport-level coverage.
- History bounds include the response envelope, preserve pagination continuity, retain incomplete output, and return exact Tool detail on demand.
- Reconnect leaves the last good conversation visible, and the open-error Retry path succeeds without reloading the page.
- Session rows and settings descriptions remain live authorities: continuation is explicit, and only concurrent identical settings reads coalesce.

## Testing

The pre-rebase production-sized browser lane reached the usable shell in 5.10 seconds with 831,177 encoded bytes under Fast 3G, reloaded from immutable cache in 338 milliseconds, and recovered the 120-turn history in 1.32 seconds with a 53,957-byte response under 400 kbit/s and 400 ms latency. Brotli quality 9 reduced that run's graph bundle to 500,852 encoded bytes without crossing the encode-time step at quality 10.

## Risks

Concatenated registration wrappers must remain execution-order independent and must not let an interior source-map trailer consume following code. A history projection that removes too much Assistant evidence can silently change latency, retry, interrupted-output, or trajectory rendering, so equivalence coverage must compare all assembled views. Cursor pages can overlap live mutations; the client must deduplicate by Session id and treat the cursor as progress through the Host's ordered baseline rather than as list identity.
