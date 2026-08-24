---
id: TASK:ui/poor-connection-web
type: task
status: accepted
summary: Bound and compress Web boot and conversation data while preserving recoverable UI state.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/poor-connection-resilience#c-boot
  - REQ:ui/poor-connection-resilience#c-history
  - REQ:ui/poor-connection-resilience#c-settled-streams
  - REQ:ui/poor-connection-resilience#c-recovery
  - REQ:ui/poor-connection-resilience#c-reconnect
  - REQ:ui/poor-connection-resilience#c-session-list
  - REQ:ui/poor-connection-resilience#c-coalescing
  - REQ:ui/poor-connection-resilience#c-security
  - REQ:ui/poor-connection-resilience#c-evidence
labels: [web, ui, mobile, performance, reliability]
assignee: carlo
---

# Poor-connection Web transport

## Acceptance

The built Web application serves one immutable client-plugin registration bundle and immutable hashed shell assets with negotiated Brotli/gzip. A cold Fast 3G profile reaches an interactive shell within eight seconds with at most 1.2 MiB of encoded boot transfer, while a warm profile reaches it within two seconds without retransferring immutable assets.

Conversation history uses complete-response byte-bounded pages, compact settled Assistant evidence, and deferred Tool-result detail. The latest page renders within twelve seconds under a 400 kbit/s, 400 ms profile in the production-sized fixture; a failed load has an explicit retry path, and reconnect keeps the last good transcript until a bounded repair commits.

Session listing returns a bounded first page plus an opaque continuation cursor, retains a requested restored Session, and loads later pages only on demand. Concurrent settings-description readers share one live request. Focused unit, real-composition, assembled browser, cache-header, compression, pagination, reconnect, and poor-network coverage pin the behavior.
