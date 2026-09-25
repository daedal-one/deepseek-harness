---
id: TASK:tasks/daedal-dsh-search-summary
type: task
status: accepted
summary: "Resolve off-page search hits through the shared Session list owner."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-client-create-profile"]
---

# Search Session summary resolution

## Plan

Add caller-cancelable shared Session summary loading through the existing generated session/list includeSessionId request. Publish only the requested Host summary, preserving current selection, continuation cursor and established rows. A successful present result makes the existing binding addressable before resolution without opening history. Search snippets never become list metadata. Absence and structured failures remain distinct and do not delete established rows.

Replay relevant live mutations over the requested summary. A removal during the read prevents stale resurrection. Concurrent list baseline or continuation responses retain the admitted summary through the existing mutation owner. Caller cancellation, Host generation changes and disposal prevent late publication; disposal joins owned reads. No mutation replay, new endpoint, Session event or data format is required.

## Acceptance

Focused shared service and manager tests prove off-page addressability, projection identity, unchanged selection/cursor, absence/failure distinction, overlapping baseline reads and live updates/removal, independent caller cancellation, reconnect replacement and joined teardown. Deterministic negative controls must fail for removal replay and cancellation guards. An actual compiled portable Client against an isolated built Host searches recorded content outside a bounded first list page, explicitly loads and opens the exact hit, reads its recorded history, and preserves other Sessions and the external Host. Build, types, lint, documentation and portable artifact checks pass before commit. Native search admission, state ownership and visible browser/Electron controls remain subsequent work.

## Sources

- [Session facade](spec:src:packages/api/session-controller/src/client/contract/sessions.ts)
- [Shared list owner](spec:src:packages/api/session-controller/src/client/sessions/manager.ts)
- [Client service](spec:src:packages/api/session-controller/src/client/sessions/service.ts)
- [Host list](spec:src:packages/api/session-controller/src/index.ts)

## Qualification

The four selected shared Session, Conversation and fixture owners pass 151 unique cases, including 15 summary cases and the fixture facade regression. Twelve initial cases failed before the method existed. Deterministic controls fail when removal replay or late-cancellation guards are disabled; source is restored. Client types, full lint, the full build, 32 documentation gates, 14 quick documentation gates and two portable artifact cases pass. Session orchestration retains its existing coverage exemption; no new percentage is claimed.

An actual compiled portable Client enrolled against an isolated built Host containing four private Sessions. With list page size one and full-text search explicitly enabled, it found the recorded off-page Session, admitted only that identity through one list request, retained selection and continuation, then explicitly opened its stable binding and read the original user and assistant text. Missing identity returned absence. A held actual reply respected caller cancellation. No model call or Session mutation request was sent, and the external Host survived Client disposal before owned teardown. All 14 generated requirements match the currently installed 096b Client. Existing older-client required-workspace-event refusal and optional registration revision differences remain unchanged.

The first runtime probe exposed the shipped full-text-search opt-in; the private fixture now enables first-search. A later probe stopped on strict snapshot identity while valid Host activation metadata arrived; it now checks preserved identities and selection, while deterministic owner tests retain exact no-mutation assertions. Initial test-state, signal-capture, strict typing and lint issues were repaired. The final review stops manager timers and Sessions before joining held summary reads. Successful and failed attempts are recorded under `.dev/daedal-dsh-plan-audit/search-summary-20260922/verification.json`.

This qualifies shared summary loading, not native search presentation. The application remains pinned to 096b, visible search controls remain unimplemented, and no source publication, deployment, app replacement or TestFlight upload is part of this component. Native search must independently admit session/search, retain caller/generation lifetimes, present a disabled Host search service as a failure, and use this owner before opening off-page results.
