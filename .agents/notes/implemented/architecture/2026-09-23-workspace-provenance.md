# Agent Note: Descriptive workspace branches and conversation provenance

Status: implemented

## Problem

Opaque returned branch names make independent coding conversations difficult to identify. Branch names can change or disappear, and commit ancestry alone cannot identify the conversation that explains a change. Rewriting returned commits to attach conversation metadata would invalidate existing hashes and references.

## Decision

The [conversation workspace owner](../../../../packages/sandbox/local-container-runtime/README.md#conversation-repositories) freezes descriptive topics separately from the deterministic identity of each original sandbox ref. The optional auxiliary model receives bounded recorded human messages and the frozen repository change summary. Code validates ASCII topics and derives a suffix from the full workspace identity and source ref. A persisted fallback precedes dispatch, and the chosen names precede ref publication. A crash may retain the fallback, but never requires another naming request for the same ref.

Each repository-turn transaction carries a stable UUID and an owner-conversation event interval. After validated Git return, the host exclusively publishes an immutable receipt under the global provenance directory, logs the same receipt, flushes the Session, and only then acknowledges return. An identical receipt retry succeeds; conflicting content under the same UUID rejects. Receipt files survive workspace checkpoint pruning and Git ref deletion. Queries reconstruct their bounded view from these authoritative files rather than trusting a mutable cache.

Observed commits include returned tips and their history beyond the imported baseline. Observation does not assert authorship. Only the automatic residual commit belongs to the receipt's created-commit set and receives conversation and receipt trailers. Agent-created commits retain their original hashes. One commit can appear in receipts from several conversations and repositories. Chat groups equal tips within each repository while retaining every alias.

The [workspace lifecycle decision](2026-09-20-conversation-git-workspace.md) remains authoritative for import, leases, checkpoints and return isolation; this note owns naming and provenance. The [accepted task](../../../../.specs/tasks/workspace-provenance.spec.md) excludes semantic-graph integration and remote metadata synchronization.

## Alternatives considered

**Use generated text as identity.** Topic collisions, model failures and conversation-title revisions would destabilize retry destinations. Generated words describe a deterministic ref identity.

**Amend every returned commit.** Rewriting hashes breaks existing refs and merges. The external receipts associate unchanged commits with conversations, while trailers are limited to newly created Harness commits.

**Treat every reachable commit as authored by the conversation.** Imported ancestors and shared branch history do not establish authorship. The receipt keeps observation and automatic creation separate.

**Keep a second authoritative database or rely on Git notes replication.** Immutable receipt files provide local lookup and explicit JSON export without database reconciliation or implicit remote publication. A larger corpus may justify a rebuildable database index; it must retain receipts as authority.

## Consequences

Lookup depends on metadata retention, not branch or transcript retention. Receipts identify deleted conversations but cannot reconstruct their contents. Exports contain repository paths and identifiers, and bounded queries report truncation rather than implying a complete export. Existing historical returns without receipts are not backfilled automatically. Configuration can share a provenance directory across profiles; no remote synchronization occurs.

Naming uses the configured auxiliary route and limits. Input overflow, malformed output, non-text output and provider failure retain deterministic names. The main conversation gains no naming instructions or model tokens. A receipt publication failure leaves the return pending even when its refs already exist; recovery reconciles those immutable refs before completing the receipt.

Focused tests exercise concurrent exclusive publication, identity conflicts, granular-commit lookup after branch deletion and restart, lost commit acknowledgements, receipt-write failure, name reuse, invalid model output, bounded queries and UI alias expansion. Recorded SDK fixtures exercise the same provenance event through TypeScript and Python. A real Flash request with explicit reasoning controls produced valid descriptive names within the configured 256-token output limit. These checks do not establish physical host-crash durability.
