---
id: TASK:tasks/daedal-dsh-history-view-lifetime
type: task
status: accepted
summary: "Cancel view-owned history reads without stopping a resident Session."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-history-detail-retention"]
---

# View-owned history reads

## Plan

Accept an optional caller AbortSignal for one-page and exact-detail reads. The first active request owns cancellation; coalesced calls share its completion. An already canceled caller dispatches nothing. Caller cancellation withdraws the read's coalescing slot and suppresses late publication and errors, while keeping the accepted window, resident Session follow and Host work alive. A new view can issue an independent request before an old canceled transport settles. Session teardown still joins every outstanding request, including those already canceled by callers.

Gateway journal pages additionally belong to the physical stream generation and accepted window from which they started. Cancellation combines those lifetimes with the logical stream and caller using the configured portable controller factory. Replaced generations and repaired windows cannot accept stale page results or stale page failures. Cancellation does not trigger automatic page retries or mutation replay.

## Acceptance

Barrier-driven Session and Gateway tests exercise pre-cancellation, late success and failure, coalescing, replacement reads, physical-generation loss, repaired-window replacement, preservation of live follow and joined disposal. Existing paging, detail retention and portable artifact checks pass. Native optional endpoint admission, view integration and actual UI qualification remain part of Phase 4.

## Qualification

The selected Gateway suites pass 66 cases with 100% statement, branch, function and line coverage for both changed stream owners. Five Session suites pass 193 cases, including caller cancellation, coalescing, replacement requests, retained details and joined disposal. Ten selected regressions fail against the preceding owner implementation. Client types, full lint, all 32 documentation gates, the Client build and both portable-artifact tests pass. Session orchestration retains its existing coverage exemption. These component checks do not establish installed native controls, scrolling or full Phase 4 acceptance.

## Sources

- [Session owner](spec:src:packages/api/session-controller/src/client/sessions/session.ts)
- [Session contract](spec:src:packages/api/session-controller/src/client/contract/session.ts)
- [Journal owner](spec:src:packages/api/gateway/src/client/journal-stream.ts)
- [Remote stream](spec:src:packages/api/gateway/src/client/remote-stream.ts)
