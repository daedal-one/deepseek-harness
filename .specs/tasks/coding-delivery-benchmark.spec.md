---
id: TASK:performance/coding-delivery-benchmark
type: task
status: accepted
summary: Build an isolated coding-delivery runner with a small synthetic corpus, independent verification, local reports, and keyless coverage.
owners: [carlo]
progress: done
addresses:
  - REQ:performance/coding-delivery#c-outcome
  - REQ:performance/coding-delivery#c-isolation
  - REQ:performance/coding-delivery#c-entry
  - REQ:performance/coding-delivery#c-evidence
  - REQ:performance/coding-delivery#c-validation
labels: [performance, benchmarks, testing]
assignee: carlo
---

# Coding-delivery benchmark

## Acceptance

A repository command runs fixed bug-fix, feature, and small-project tasks through built dsh in disposable worlds, verifies candidate artifacts independently, and writes versioned JSON plus a readable outcome summary. Scripted-model checks exercise success, repair, failure, and bounded execution without API keys. Live execution is opt-in and uses the same evaluator. Diagnostic spans identify their clock and attribution limits; documentation records the measurement card and exact validation evidence. No production loop, Session format, or GUI behavior changes.

## Measurement card

| Field | Decision |
|---|---|
| User operation | Submit one synthetic coding task; finish after an idle candidate and independent artifact acceptance. |
| Workload | Three versioned dependency-free Node ESM tasks with fixed buggy/stub files and edge-case acceptance inputs; repeated trials reset all task and Harness state. |
| Entry path | Compiled controller and public TypeScript SDK launch built dsh with the sdk-minimal profile plus explicit production editor; only the keyless model is scripted. Manual live runs are separate from the network-free required lane. |
| Clock | One controller monotonic clock; delivery starts before the first prompt and includes every repair and verifier attempt. Fixture setup is excluded; profile boot and awaited cleanup are measured separately. Reported cache usage retains coverage; no cold-cache assumption. |
| Memory | No retained-memory or peak-RSS claim; bounded trace span retention and subprocess output, fresh process/world per trial, and awaited cleanup. Unconfirmed cleanup stops the experiment and retains evidence. |
| Verdict | Preserve all raw trials and outcomes; accepted-only latency is labelled and paired with failure counts. No uncalibrated latency gate; keyless acceptance and rejection controls gate behavior. |
| Behavior | Unchanged/wrong code, modified protected files, missing evidence, deadline expiration, and infrastructure/cleanup errors cannot count as accepted. Product runtime and existing durability behavior remain unchanged. |
