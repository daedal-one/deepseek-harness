---
id: TASK:tasks/daedal-dsh-workspace-rejection
type: task
status: accepted
summary: "Distinguish Workspace path rejection before registration from uncertain persistence failure."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-workspace-lookup"]
---

# Workspace registration rejection

## Plan

Give native registration a Host-proven rejection for an invalid directory, so an explicit corrected attempt need not remain blocked as unknown. The registry owns fully qualified path canonicalization and directory validation before enqueueing any registration write. Wrap only failures in that validation stage with a typed path error, preserving the original cause. Persistence, rollback and failures after registration begins must not acquire that type or guarantee.

The Workspace command exposes `workspace/create-rejected` only when its initial read fails before calling create, or when registry creation raises the typed pre-write validation error. Preserve already structured Remote failures and the existing broad `workspace/invalid-path` mapping for other registry errors; that older code never proves non-publication. A rejection means this request began no registration write, not that no registration exists at the path.

Mark workspace/create business semantic revision 2. Keep all other endpoint modes, wire fingerprints and revisions unchanged. The Host must refuse revision-1 compatibility expectations before invoking the Workspace command; unnegotiated Web callers retain the existing request/result shape. No Session event, storage generation or automatic replay is added. The portable Client preserves the structured error for native controllers. Current registration lookup remains a separate observation and cannot determine an earlier request's outcome.

## Acceptance

Focused registry and Host tests prove relative, missing and file paths reject without registry writes, while successful and existing-path registration retain identity and created semantics. Reproduce failures after real registration publication and prove they cannot become definite rejection. Client tests preserve the new error and leave followed state unchanged. Negative controls reject broad classification of registry failure and missing typed validation. Run relevant coverage, types, full build, documentation and portable artifact checks. An actual compiled Client against an isolated built Host observes safe path rejection, a subsequent explicit corrected request, optional revision mismatch refusal before registry mutation, and durable registration after a lost reply. Preserve no automatic replay, external Host lifetime and private-fixture cleanup. Native journal handling and visible UI remain separately qualified work.

## Sources

- [Registry](spec:src:packages/workspace/workspace/src/index.ts)
- [Host commands](spec:src:packages/api/workspace-controller/src/commands.ts)
- [Remote owner](spec:src:packages/api/workspace-controller/src/index.ts)
- [Client facade](spec:src:packages/api/workspace-controller/src/client/service.ts)

## Qualification

The eight selected registry, Host, Client and test-runtime owners pass 141 cases; the eight measured runtime modules have 100% statement, branch, function and line coverage. Two negative controls fail when post-write errors become rejection or validation loses its typed error. Full build, Host and Client types, final lint, 32 documentation gates, 16 hygiene gates and two portable artifact cases pass. Assertion typing and arrow style findings were repaired without suppression.

An actual compiled Client against an isolated built Host rejects relative, missing and file paths with no registration, then accepts a separate explicit corrected request. A deliberately lost accepted reply is resolved by reads alone with one create and zero redispatch; the same registration survives Host restart. Symlink retargeting, deletion/re-registration and caller cancellation retain the separately qualified lookup semantics. No model request or live Session mutation was issued; Clients leave the external Host alive and owned Hosts and private fixtures are removed afterwards.

Eleven other endpoint descriptors and the optional lookup remain identical to the installed 7f Client; the eleven endpoints also match the exact delivered TestFlight 7003007 archive. Workspace creation changes only semantic revision 1 to 2. The old shared facade sends one guarded request, which the Host refuses before registry mutation. The actual installed native registration owner separately marks creation unavailable and sends zero create requests, while lookup admission and the Workspace baseline remain usable. The initial audit incorrectly expected the shared facade itself to suppress the HTTP request; the recorded qualification distinguishes Host refusal from native feature admission. A separate audit timing correction waits for the Workspace baseline after admission.

Evidence is `.dev/daedal-dsh-plan-audit/workspace-rejection-20260921/verification.json`. The frontend remains pinned to 7f and its registration controls remain hidden. Native durable rejected-outcome handling, an exact new portable pin and visible registration controls require their own qualification. Phase 4, publication and release acceptance remain in progress; physical iPhone execution remains unperformed under Carlo's acceptance of the delivered build.
