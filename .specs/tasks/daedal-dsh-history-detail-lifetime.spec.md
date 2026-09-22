---
id: TASK:tasks/daedal-dsh-history-detail-lifetime
type: task
status: accepted
summary: "Cancel and join deferred history-detail reads with their Session owner."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-history-paging"]
---

# Deferred history-detail read lifetime

## Plan

Issue an exact-detail read only for a deferred event in the active history window. Repeated requests for that event share completion. Pass an AbortSignal through the generated Remote request. Session replacement, disposal or terminal stream failure invalidates and cancels all outstanding reads, then joins their settlement. Obsolete responses and failures cannot replace a new window, publish an error, or remove a replacement request. An active read failure remains explicit and can be retried without losing the compact event. Successful hydration changes only the requested event and avoids repeated downloads.

## Acceptance

Deterministic request barriers prove exact hydration, coalescing, explicit retry, abort propagation, joined cleanup, stale-success and stale-failure silence, and request isolation between replaced generations. Existing Session lifecycle tests and portable Client artifact checks pass. Detail retention budgets, native optional endpoint admission, history controls and installed app qualification remain part of the full Phase 4 increment.

## Qualification

Five selected Session lifecycle suites pass 192 tests, including 71 Session-owner cases. Explicit request barriers cover hydration, retry, cancellation, reentrant abort, resync, terminal stream failure followed by disposal, and stale completions after replacement. Four selected cases fail against the preceding owner implementation. Client type checks, full lint, all 32 documentation gates, spec lint, the Client build and both portable-artifact tests pass. The existing Session orchestration coverage exemption is unchanged; no coverage percentage, installed native UI or physical-device execution is claimed. Full Phase 4 retention, admission, UI and release qualification remains open.

## Sources

- [Session owner](spec:src:packages/api/session-controller/src/client/sessions/session.ts)
- [Session contract](spec:src:packages/api/session-controller/src/client/contract/session.ts)
- [Session regression owner](spec:src:packages/api/session-controller/tests/session.client.spec.ts)
