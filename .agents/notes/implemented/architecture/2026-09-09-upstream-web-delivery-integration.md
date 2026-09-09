# Agent Note: Keep upstream document previews within the Web startup budget

Status: implemented

## Problem

Upstream's PDF renderer embeds character maps, fonts, and image decoders in its browser registration artifact. The integrated Web application transferred 4,949,717 bytes and reached the shell in 25.6 seconds under the Fast 3G browser profile, exceeding the fork's 1.2 MiB and 8-second limits. Most of the transfer belonged to resources needed only by specific PDF documents.

## Decision

Keep upstream's ordered bootstrap and application combo delivery. Enable negotiated Brotli compression through the maintained HTTP middleware, preferring Brotli when client quality weights tie, with configurable quality and gzip fallback. Immutable script caching and uncompressed SSE remain transport responsibilities.

PDF binary resources are embedded in the Host artifact from the same pinned PDF.js package as the browser worker. The document-preview plugin owns the authenticated `/api/pdf-assets` exact Connection Fetch route and admits only exact resource-family and filename pairs present in that artifact. Each PDF document supplies its abort signal to those reads and receives independently transferable bytes. No document content or arbitrary filesystem path enters this route. The worker source is fetched through the same route before worker construction; both artifacts retain the bundled license notices.

Initial history now arrives through upstream's Session follow snapshot. The bounded projection applies before that publication, while the Client preserves retry and reconnect behavior. Losing the Host generation marks resident open transcripts as waiting without clearing their messages; a successful follow snapshot clears that state. Browser validation observes actual WebSocket snapshots, including their frame envelope, instead of expecting the retired unary initial-history request.

## Alternatives considered

**Raise the startup budget.** That would preserve transfer proportional to the entire PDF resource inventory even for users who never open a PDF.

**Remove PDF previews.** This would omit requested upstream functionality.

**Fetch PDF resources from a public CDN.** It would add an external dependency and risk a resource/runtime version mismatch. The existing authenticated Connection also covers local Worker and desktop carriers.

## Consequences

The initial browser transfer is independent of the PDF binary-resource inventory. A PDF resource read can fail or be cancelled independently; the document renderer owns its retry and reports failures through its existing UI.

## Validation

Resource tests cover lazy reads, exact-name admission, invalid wire data, transferable-buffer ownership, cancellation propagation, and route disposal. The real HTTP test verifies Brotli, gzip fallback, and explicit identity preference. The assembled browser flow verifies preview rendering and measures cold boot, cached reload, history delivery, retry, and reconnect on the integrated build.
