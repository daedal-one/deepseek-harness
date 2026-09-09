# Agent Note: Preserve fork evidence across Session generations

Status: implemented

## Problem

Fork Session logs contain authorization decisions, reviewed-memory extraction inputs, English-output translations, OpenRouter search requests, and trusted child principals. Upstream's frozen migration inventories cannot admit these records without explicit payload validation. Stream compaction also removes chunk events and changes sequence coordinates, so copying every numeric reference would misattribute evidence.

## Decision

The frozen V0 decoder admits the fork's recorded event families through finite payload validators. Classifier inputs and intent context keep same-artifact references; every structural migration remaps them through its established sequence map and refuses invalid references. Child descriptors preserve the trusted principal.

Memory extraction inputs are historical captures. Their sequence lists retain the coordinates of the captured generation, identified by `sourceSessionFormatVersion`. Each migration stamps the source generation only when that field is absent. Current extraction records carry the writer's generation explicitly. This retains attribution when a referenced assistant chunk has become part of an embedded stream.

The fork uses the upstream stateful migration chain and immutable successor publication described in [released Session migration](2026-08-31-released-session-format-migrations.md). Unsupported historical events remain errors, including unknown ignorable records. Migration does not reinterpret policy results or recalculate auxiliary model output.

## Alternatives considered

**Drop unrecognized fork records.** Removing authorization or model-visible input would leave an apparently valid log whose decisions cannot be reconstructed.

**Treat every sequence list as current coordinates.** Deleted chunk records have no one-to-one target event. Mapping captures to surviving messages would change what the extractor actually saw.

**Retain the old Session runtime.** That would split persistence, history, and replay semantics from the upstream implementation. Explicit adapters at migration and API consumers preserve the fork's behavior without maintaining a second runtime.

## Consequences

Historical replay retains the original generation as evidence alongside its migrated successor. Consumers must interpret extraction coordinates using the capture's generation. The accepted maintenance task requires malformed-record rejection, full-chain fork fixtures, live policy tests, and assembled runtime validation; a successful source rebase alone is insufficient.
