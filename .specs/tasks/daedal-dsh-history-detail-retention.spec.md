---
id: TASK:tasks/daedal-dsh-history-detail-retention
type: task
status: accepted
summary: "Bound explicitly hydrated history details across one Client Host."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Client history-detail retention

## Plan

Measure retained memory for a fixed 10,000-event history with the shared Session owner and Chat projection alive, before changing retention. Add an explicit Client composition policy covering all resident Sessions for one Host. Charge hydrated entries by complete JSON UTF-16 code units; evict the oldest hydration back to its original compact entry without losing event order, paging state or authoritative metadata. An entry exceeding the configured limit fails explicitly without truncating it or evicting accepted details. Reload remains an explicit user action. Replacement and disposal release retained entries. The browser's existing composition remains unchanged unless it opts in.

## Acceptance

Record fresh-process baseline and bounded samples with identical fixed inputs and forced garbage collection. Assert exact retained payload limits, current Chat content and the full event window, including across multiple resident Sessions. Verify eviction, reload, oversized entries, failure, replacement and disposal with deterministic tests. Derive a memory regression budget from the measured reference and prove the unbounded implementation fails it. Component measurements do not establish native UI, physical-device, process-peak memory or complete Phase 4 acceptance.

## Qualification

The compiled Node workload retains all 10,000 events, 6,000 Chat nodes and 6,000 subscribed row readers. Three fresh-process tail samples retain 8,741,808–8,745,264 additional heap bytes with an explicit 8,388,608-character allowance, versus 68,524,752–68,526,144 bytes with the existing unbounded policy. Six smaller-workload comparison samples retain 2,114,120–2,410,872 bytes. Original pre-change Session/Chat samples are also recorded separately. The executable budgets allow 4 MiB for the typical workload and 16 MiB for the tail; all unbounded tail controls exceed the latter. Retained serialized payload is charged independently of heap measurement.

The four selected Session owners pass 177 cases, and the new accounting module has 100% statement, branch, function and line coverage. Three behavior controls fail when retention is disabled. Two built portable-artifact cases pass, including exact oversize refusal, eviction through generated RPCs, strict consumer declarations and execution without Node/browser globals. Full build, Client types, lint, 32 documentation gates, 16 hygiene gates and spec lint pass. Existing conversation-fold and the two retained-memory benchmark cases pass. These are component and built-artifact results; native history controls, optional endpoint admission, a new app artifact and full Phase 4 release qualification remain open.

## Sources

- [Session owner](spec:src:packages/api/session-controller/src/client/sessions/session.ts)
- [Session composition](spec:src:packages/api/session-controller/src/client/platform.ts)
- [Session manager](spec:src:packages/api/session-controller/src/client/sessions/manager.ts)
- [Conversation benchmark lane](spec:src:benchmarks/conversation-fold/conversation-fold.worker.client.ts)
- [Retention owner](spec:src:packages/api/session-controller/src/client/history-detail-retention.ts)
- [Retention behavior tests](spec:src:packages/api/session-controller/tests/detail-retention.client.spec.ts)
- [Retained-memory benchmark](spec:src:benchmarks/conversation-fold/history-detail.worker.client.ts)
