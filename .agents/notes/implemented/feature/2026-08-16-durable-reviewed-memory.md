# Agent Note: Durable reviewed memory

Status: implemented

English | [中文](2026-08-16-durable-reviewed-memory.zh.md)

## Problem

Session transcripts preserve what happened but do not provide a bounded, queryable source of durable project knowledge. Automatically treating extracted text as truth would let guesses, stale facts, tool-output instructions, or an acting model's claimed role become long-lived authority. Global memory also crosses project isolation and needs explicit human consent for every mutation.

## Decision

Memory is a complete capability seam. `dsh-memory` owns explicit project/global scopes, branded ids, compare-and-set revisions, evidence, trust, temporal validity, contradiction links, and provider selection. `dsh-memory-sqlite` owns one application-identified monotonic schema, transactional lifecycle transitions, conservative retention, and bounded scope-local search. Ordinary tools expose query, get, propose, challenge, and checkpoint; each global write requests approval at execution and only `allowed-once` proceeds.

Pending-item discovery, review, supersession, and deletion are separate tools. They authorize from the durable `subagent/descriptor` principal selected by configuration, never model arguments, persona text, or a role label. The authorization check runs on every execution. Global reviewer mutations retain the same one-time approval requirement.

The extractor observes a completed `turn/end`, waits for session persistence to flush, and uses a bounded queue. It records and flushes the exact auxiliary request before dispatch, then records the assembled response, finish state, usage, proposal ids, and bounded failure. Extracted facts are project-scoped proposals; they are not active until review. Queue saturation, malformed output, timeout, cancellation, and provider failure settle without failing the parent turn. Disposal aborts and awaits active work.

## Alternatives considered

**Inject extracted facts directly into prompts.** Rejected because model-visible state would lack a durable review lifecycle and stale or contradictory claims could silently override current evidence.

**Authorize reviewers from a role tool argument or persona.** Rejected because both are model-controlled text. The durable process-owned subagent principal is the authorization fact.

**Use the session log as the query database.** Rejected because project/global isolation, review transitions, retention, temporal filters, and cross-session lookup would be duplicated across Consumers and would couple memory schema evolution to transcript persistence.

## Consequences

Durable facts remain evidence-bearing and reviewable, project boundaries are explicit, and global state cannot change without a live approval decision. Retrieval adds only selected records to model context. Extraction adds bounded auxiliary latency after the parent turn, while provider failures leave the completed turn intact. Search is currently substring-based and can be replaced behind the provider interface after corpus measurements justify ranking infrastructure.
