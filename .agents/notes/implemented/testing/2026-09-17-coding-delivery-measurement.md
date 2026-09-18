# Agent Note: Independently verified coding-delivery measurement

Status: implemented

## Problem

Local request and continuation benchmarks exclude model/network latency and do not establish how quickly an agent produces an acceptable project. Timing only successful agent replies rewards incorrect early completion, omits repair work, and can make overlapping tools appear slower than their elapsed critical path.

## Decision

The [coding-delivery evaluator](../../../../benchmarks/coding-delivery/README.md) owns a small, versioned synthetic Node corpus, private trial worlds, controller-owned acceptance, and outcome-preserving local reports. Built plain-Node controllers drive the public SDK and shipped sdk-minimal profile with an explicit production editor. The keyless control replaces only the model; the required benchmark lane never calls network services. Manual live execution requires two explicit flags acknowledging provider charges and unrestricted generated-code execution.

One monotonic controller clock measures first submission through independently accepted artifacts, including every verification attempt and repair. Startup and awaited cleanup have separate fields. Deadline interruption settles independently of the SDK activity promise; teardown failure stops subsequent trials and preserves the private world when runtime exit is unconfirmed. Runtime event spans remain diagnostic and clock-labelled: buffered stream records do not establish request dispatch, inference throughput, or provider-phase attribution. Reported token fields retain coverage; missing counts are not zero. Accepted-only latency always appears beside complete outcome counts. Paired comparisons preserve one-sided failures and incomplete pairs.

Each acceptance attempt copies only declared deliverables to a fresh verifier root, checks protected fixture files, and executes fixed cases outside the agent workspace. Exit success without complete result evidence is insufficient. Only candidate invocation exceptions satisfy expected-error cases; verifier setup and serialization failures cannot count as correct behavior. Artifact verification follows every returned idle candidate independently of its turn-end reason. The verifier bounds process time and output and awaits exit before deleting owned files. The evaluator is for trusted synthetic experiments, not adversarial submissions; its private directories are not a security boundary against unrestricted tools.

## Alternatives considered

**Optimize against mock-model latency alone.** Rejected as a project-delivery metric because it excludes model speed, quality, and corrective iterations. The existing [backend-continuation decision](2026-09-06-backend-continuation-performance.md) remains authoritative for local overhead and calibrated budgets.

**Add model calls to required performance checks.** Rejected because credentials, provider load, charges, and response variation undermine deterministic CI. Manual live experiments share the evaluator without entering the required lane.

**Treat every diagnostic duration as additive.** Rejected because step and tool intervals overlap, runtime clocks differ from controller clocks, and the SDK does not expose a complete causal dependency graph. Reports do not claim an inferred critical path.

**Expand the corpus before verifying the instrument.** Deferred in favor of three edge-case tasks plus negative and repair controls. Larger repositories, long sessions, full-profile composition, transport instrumentation, and uncertainty estimates remain separate work.

## Verification

Source-plane tests cover fixture rejection, reference acceptance, deadline and cancellation handling, protected-file checks, incomplete result evidence, trace overlap, usage coverage, configuration parsing, and failure-aware aggregation. Built-profile keyless controls exercise production tools and external acceptance for all tasks, an unsuccessful first round followed by repair, false completion, and a stalled model. Runtime behavior, Session formats, SDK protocols, and GUI output are unchanged.

Validation on Linux with Node `v24.21.0`:

- `pnpm run build:bench` passed both compiler faces and built the controllers.
- `pnpm exec vitest run scripts/coding-delivery*.spec.ts` passed 80 source tests.
- `pnpm exec vitest run --config vitest.bench.config.ts benchmarks/coding-delivery/coding-delivery.bench.ts` passed six built-profile controls.
- `pnpm benchmark:coding` accepted all three scripted tasks; its local report preserves 35 successful acceptance cases and no cleanup errors.
- `pnpm run doc-sync` passed all 32 gates. These checks establish the instrument's behavior, not provider-backed performance.

## Consequences

Contributors can collect a local baseline without credentials and opt into provider-backed experiments without mistaking local overhead for model performance. No provider-backed result, memory improvement, or statistically established speedup follows from keyless validation. The [performance-gate decision](2026-09-04-session-open-performance-gate.md) and [evidence-driven performance workflow](../process/2026-09-06-evidence-driven-performance-skill.md) retain their independent calibration and optimization rationale; no active note is superseded.
