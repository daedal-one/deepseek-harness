---
id: TASK:tasks/daedal-dsh-history-paging
type: task
status: accepted
summary: "Expose retryable older-history failures and own paging teardown in the shared Client."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-native-client"]
---

# Observable Client history paging

## Plan

Expose an older-page failure in the shared Session snapshot while preserving the accepted event window and cursor. Clear the failure only when an explicit new paging operation begins or its Session history owner is replaced. Coalesce repeated single-page requests. Keep turn-jump paging and single-page reads under one operation owner; a rejected page is not a successful empty result and reconnect must not restart that user request.

Invalidate pending paging state before replacing or disposing its history stream. Cancel through the existing stream lifetime, await the pending operation at teardown, and prevent stale results or finalizers from changing a replacement generation. Preserve structured Remote failures; report other transport exceptions as a structured internal failure without losing the original diagnostic.

## Acceptance

Deterministic barriers prove failure and explicit retry, retained cursor/window, concurrent request coalescing, replacement while paging, disposal completion and stale-result silence. Existing single-page and turn-jump behavior remains covered. Typecheck every Session snapshot consumer and regenerate its published Client catalog. Native controls, deferred-detail lifetime, optional endpoint admission and installable app delivery remain the separate Phase 4 increment.

## Qualification

The shared Session owner passes 60 deterministic tests, including explicit retry with the same cursor, coalesced completion, joined disposal, and superseded replacement. Four selected regressions fail against the preceding owner implementation. Eight existing UI consumer suites pass 230 cases. Client type checks, full lint, all 32 documentation gates, the Client build and both portable-artifact tests pass. The existing Session orchestration coverage exemption remains unchanged; these runs do not establish a coverage percentage. Native history controls, deferred-detail lifetime, app artifact delivery and full Phase 4 acceptance remain separate work.

## Sources

- [Session owner](spec:src:packages/api/session-controller/src/client/sessions/session.ts)
- [Observable snapshot](spec:src:packages/api/session-controller/src/client/contract/snapshot.ts)
- [Session regression owner](spec:src:packages/api/session-controller/tests/session.client.spec.ts)
