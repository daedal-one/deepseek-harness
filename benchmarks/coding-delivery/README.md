# Coding delivery benchmark

## Summary

Measure a coding task from first prompt submission through independently verified artifacts, including repair rounds. Three synthetic, dependency-free Node tasks run in private workspaces through the built TypeScript SDK and `dsh --profile sdk-minimal`, with the production filesystem editor added. The keyless model supplies scripted tool calls; explicitly enabled live experiments use a configured model and the same acceptance checks. The controller writes local JSON evidence and a Markdown scorecard. This is an initial measurement instrument, not evidence that one model or configuration is faster.

## Table of Contents

- [Run](#run)
- [Configure experiments](#configure-experiments)
- [Read the results](#read-the-results)
- [Measurement limits](#measurement-limits)
- [Dev Note](#dev-note)

## Run

From the repository root, build the libraries and plain-Node controllers, then run the default keyless experiment:

```sh
pnpm run build:bench
pnpm benchmark:coding
```

The command prints a new directory under `.artifacts/coding-delivery/`. `metadata.json` identifies the experiment, `trials.jsonl` preserves each completed trial incrementally, and `report.json` plus `report.md` summarize the outcomes. `--output <directory>` requires a new directory and never overwrites a previous experiment. A failed, timed-out, cancelled, or infrastructure-error trial makes the command exit nonzero; its evidence remains available.

Run the paired scripted controls with:

```sh
pnpm benchmark:coding --config benchmarks/coding-delivery/example.scripted.json
```

The existing required benchmark lane includes network-free acceptance, rejection, repair, and stalled-model controls. After building, its focused command is:

```sh
pnpm exec vitest run --config vitest.bench.config.ts benchmarks/coding-delivery/coding-delivery.bench.ts
```

These controls verify the measurement endpoint; they do not enforce an uncalibrated latency budget. Source-plane regression tests live under `scripts/coding-delivery*.spec.ts`.

## Configure experiments

The JSON object accepts `tasks`, `variants`, `repetitions`, `seed`, `deadlineMs`, and `maxRepairs`. Defaults are all three tasks, one scripted variant, one repetition, seed `1`, a 120,000 ms delivery deadline, and one repair. Task identifiers and exact contracts live in [tasks.ts](tasks.ts). Variants run sequentially in adjacent task/repetition pairs, with reproducibly shuffled variant order. Every trial starts a fresh runtime and resets its workspace and Harness home.

Scripted variants accept an `id` and `scriptedBehavior`: `solve`, `repair`, `fail`, or `hang`. They cannot load arbitrary patches, credentials, or a network provider. The supplied reference solution exercises actual read/edit tools rather than writing the answer from the controller.

Live variants require explicit `id`, `provider`, `model`, and `credentialEnv` fields. `credentialEnv` names an existing environment variable; never put the credential itself in JSON. Optional `reasoningEffort`, `maxTokens`, and ordered `patches` select request settings and profile overlays. Patch paths resolve relative to the configuration file; plugin paths within copied patches must be absolute. The report records patch hashes and the credential variable name, never patch contents or the credential value. A patch whose bytes change after the experiment is recorded cannot start a trial. Only the named credential and platform-essential environment entries reach the runtime; ambient `.env` files, private profiles, and sessions are not used.

Live invocation requires both `--live` and `--allow-unconfined` alongside a configuration file. It can incur API charges and execute generated code with the minimal profile's unrestricted tools. Run it inside a disposable container or VM. Private directories are reproducibility isolation, not hostile-code containment. Provider-backed execution requires a separate authorized validation run; keyless results make no claim about its latency or task success.

## Read the results

`deliveryMs` uses the controller's monotonic clock from immediately before the first prompt through acceptance, retaining all failed checks and repair rounds. `bootMs` and `cleanupMs` are separate; `totalMs` includes runtime startup and awaited shutdown. Fixture creation is excluded from successful-trial timings. Startup errors have no delivery duration. Cancellation retains a partial trial, and the report distinguishes planned from completed trials. Cleanup failures stop the remaining schedule, remain visible alongside task outcomes, and identify any retained workspace for manual recovery.

Acceptance executes controller-owned cases against copied, allowlisted candidate files in a fresh verifier process. The original task metadata remains protected, and unchanged code, missing results, modified protected files, or a successful exit without complete evidence do not pass. Verification is not the agent's own test verdict. Every returned idle candidate is checked, including a token-limited turn; `agentTurns` records the termination reason independently. Only errors thrown by the candidate function satisfy expected-exception cases; import, export, and serialization errors reject the candidate.

The scorecard includes every observed outcome. Median and p95 durations are explicitly accepted-only; p95 is omitted below 20 accepted samples. Paired comparisons retain one-sided failures and missing pairs alongside ratios for jointly accepted trials. No confidence interval or automatic winner verdict is calculated.

Diagnostic traces contain counters, available token usage with reporting coverage, bounded step/model-stream/tool intervals, and incomplete work. Runtime event timestamps and controller phase timestamps belong to different clock domains. Model-stream intervals start at the first recorded chunk, not request dispatch; buffered chunks cannot establish inference speed. Tool service-time sums and interval unions describe different quantities; neither is labelled the task critical path. Trace payloads omit prompts, code, arguments, and original session identifiers.

## Measurement limits

- The three small Node tasks do not represent general coding quality, large projects, or long-history work.
- The minimal profile plus editor is not the full Web coding composition. No browser, human approval, or GUI latency is measured.
- Checkpoint, serialization, provider queueing, and prefill costs are not separately instrumented. Unsettled requests may lack stream evidence when shutdown removes SDK listeners.
- Provider cache state is not forced cold. Missing usage is reported as missing; scripted replies do not fabricate token counts.
- No process-tree memory or provider pricing is measured. Entry artifact hashes do not fingerprint all transitive runtime dependencies.
- Generated code and custom live patches are trusted inputs to this first evaluator. Separate process execution and Node permission controls are not an adversarial security sandbox.

The [measurement decision](../../.agents/notes/implemented/testing/2026-09-17-coding-delivery-measurement.md) records scope and alternatives. Existing [backend continuation benchmarks](../agent-continuation/README.md) remain the calibrated local-overhead authority.

## Dev Note

None.
