# Agent Note: Deferred tool discovery from recorded search results

Status: implemented

## Problem

Large specialist tool inventories consume request context before an agent knows which capabilities it needs. Filtering schemas alone is insufficient: resumed sessions need the same discoveries, scoped restrictions must still apply, and native calls and program bindings must agree about what can execute.

## Decision

The [tool registry](../../../../packages/core/tools/README.md#defer-specialist-tools) owns opt-in presentation by literal tool-name prefix. Its registered `tool_search` searches only the caller's authorized deferred definitions. MiniSearch supplies maintained BM25+ lexical ranking, with deterministic name ordering for ties; deployment configuration bounds queries, result counts, and the complete JSON result. Eager profiles retain their tool sets. This adopts the deferred-search mechanism illustrated by [Codex tool search](https://github.com/openai/codex/blob/e9633d7a0226eac91c7a791dc4f92cf8f25df2ae/codex-rs/core/src/tools/handlers/tool_search.rs) through DSH's registry and Session model.

Admission derives only from successful recorded native search settlements or nested PTC dispatch results. A registry-owned weak cache incrementally folds the full Session log and is disposable; resume and fork reconstruct it from the same records. Existing request headers record the exact resulting schemas. Failed, cancelled, or post-policy-blocked searches contribute no names. No separate mutable admission file or additional Session event is required.

Request assembly, both language SDKs, and executor lookup intersect admission with current scope visibility. Registry inventory and presenter lookup retain all authorized definitions so discovery and historical rendering can inspect them. Unregistration and restrictions remain authoritative after a name is admitted. Discovery never supplies permission to execute. PTC bindings are captured at program start, so a program that searches must return before a later program uses its discoveries.

The existing generic tool card displays the query and bounded JSON result. The result contains selected names and a truncation flag; full schemas arrive on the next request. No client-specific renderer or duplicate presentation metadata is required.

## Alternatives considered

**Always publish every schema.** Retained as the default for small inventories, but it makes large optional inventories pay their full context cost on every request.

**Embeddings or a custom lexical scorer.** Neither is needed for the initial bounded search. MiniSearch avoids an owned relevance algorithm; an embedding service would add routing, cost, and asynchronous index lifetime.

**Admit during the tool body or store an independent set.** A body can still fail post-execution policy or cancellation, and independent mutable state can disagree with restored history. Settled durable results already carry the necessary evidence.

## Consequences

Deferred schemas save initial request space at the cost of a discovery step. Admission grows within a Session and changes its schema prefix; there is no eviction policy. Search covers registered tools only and does not lazily connect providers. Unit and assembled recorded-session coverage must preserve scope restrictions, failed-result exclusion, count and byte bounds, native/PTC execution agreement, and restoration from recorded results.
