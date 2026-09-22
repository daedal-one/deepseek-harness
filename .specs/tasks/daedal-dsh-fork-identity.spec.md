---
id: TASK:tasks/daedal-dsh-fork-identity
type: task
status: accepted
summary: "Fork to a caller-owned child identity without changing the existing fork endpoint."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-search-summary"]
---

# Caller-owned fork identity

## Plan

Add an optional generated session/forkTo operation and shared ISessions.forkTo facade with a required fresh childSessionId. Reuse the existing completed-turn cut, preset, model and Workspace owners. The caller retains the exact source, anchor and fresh child identity before dispatch. Existing session/fork wire and business revision remain unchanged. The new operation never adopts an existing identity, retries a mutation, resumes the source, or renames the child. Persistence and live registry collision enforcement retain the original child unchanged. A requested title change is a separate operation after the caller knows the child identity.

A successful reply or structured Workspace attachment failure supplies the published child identity through the shared list owner. Other failures remain potentially uncertain; the requested identity stays available on the typed fork error but does not create a synthetic list entry. Read-only exact summary loading may discover the current child and its parent after a lost reply, including after Host restart. That observation is not proof that the original request completed every step. Absence cannot authorize replay; parent or title matches never select an alternative child. No Session event, header field or persistence generation changes.

## Acceptance

Focused Host and shared Client cases prove exact destination forwarding, unchanged completed-turn boundaries, cold source reads, duplicate/concurrent identity collision without overwrite, no title rename, successful binding availability, partial Workspace attachment publication, and uncertain failure without fabricated rows. Negative controls fail when the Host ignores the caller identity or the Client publishes unknown attempts. A real compiled Client against an isolated built Host forks a committed recording, loses one accepted reply, discovers that exact child through explicit reads, and repeats the read after restart with zero redispatch. Stored child prefix and lineage are checked independently; wrong parent/current-child observations must not be called acceptance. Existing endpoint descriptors remain byte-equivalent, with only forkTo added. Run selected tests, build/types/lint/documentation and portable artifact checks, then commit inspected paths with normal hooks.

Native durable journals, explicit current-child review/adoption, optional admission, title handling, Workspace completion review and visible controls remain subsequent work. Do not expose controls or call Phase 4 complete from this prerequisite.

## Qualification

The isolated built Host and compiled portable Client passed recorded-prefix forking, an accepted reply lost at the carrier, explicit exact-child lookup before and after Host restart, legacy forking and identity collisions with no overwrite or automatic redispatch. The stored inherited prefix and unchanged source bytes were checked independently. Workspace attachment failure is qualified by typed Host and Client cases; no real storage fault was induced. The current child observation does not attest complete original-request acceptance.

179 selected cases across six owners, two failing negative controls, full build, final Client compilation, lint, 32 documentation gates, 14 quick documentation gates and two portable artifact cases passed. Fifteen existing generated endpoint descriptors remain identical; forkTo adds one optional revision-1 endpoint. Native journals, admission and visible controls remain subsequent work. Attributable logs, scripts, source hashes and successful and failed action receipts are retained under .dev/daedal-dsh-plan-audit/fork-identity-20260922.

## Sources

- [Host fork owner](spec:src:packages/api/session-controller/src/commands.ts)
- [Remote service](spec:src:packages/api/session-controller/src/index.ts)
- [Shared facade](spec:src:packages/api/session-controller/src/client/contract/sessions.ts)
- [Shared list owner](spec:src:packages/api/session-controller/src/client/sessions/manager.ts)
- [Shared Client service](spec:src:packages/api/session-controller/src/client/sessions/service.ts)
