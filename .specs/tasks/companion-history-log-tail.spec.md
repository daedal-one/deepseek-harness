---
id: TASK:tasks/companion-history-log-tail
type: task
status: accepted
summary: Bound log-only history tails without losing durable events or closing companion streams.
owners: [carlo]
progress: done
addresses: ["REQ:ui/poor-connection-resilience#c-history", "IFC:frontend/daedal-dsh-client"]
---

# Companion history log tails

## Plan

Page a trailing run of events without surface operations independently of the preceding message group. Apply the existing complete-response byte allowance, retain contiguous sequences and backwards cursor progress, and keep indivisible surface message groups and individual oversized events explicit. Preserve every durable event and the existing wire schema, Session generations, authentication and transport limits.

## Acceptance

A long workspace-status tail opens and pages within the configured allowance. Repeated older pages reconstruct the exact journal with no gaps, duplicates or stalled cursor. Cover multibyte values, histories containing only log events, metadata allowance, indivisible oversized records and ordinary message-group behavior. Verify the actual affected server Session through the existing companion transport limit, without rewriting stored logs or sending model prompts. Activation remains separate from candidate qualification.

## Sources

- [History owner](spec:src:packages/api/session-controller/src/history.ts)
- [Journal tests](spec:src:packages/api/session-controller/tests/session-history-journal.host.spec.ts)

## Evidence

The Session and subagent controller owners pass 851 tests with 100% statement, branch, function and line coverage of the history module. The focused real Web composition replays 7,024 recorded and log-only events across three bounded pages and retains every event sequence. The projection and zero-model-call tripwires pass. A read-only capture of the affected server journal passes through the unchanged deployed companion transport: 42,406 projected events across 103 pages, with a 524,000-byte opening snapshot and a maximum 524,055-byte page, instead of the 49,280,674-byte opening frame.

Lint, both compiler faces, all 32 documentation gates and specification lint pass. The broader seeded-history UI replay still has access-selector and disclosure presentation failures, including failures with the unchanged deployed Host artifact; its unrelated expectations remain unchanged. Server activation requires separate preservation and readiness verification.
