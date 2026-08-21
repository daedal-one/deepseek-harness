# Benchmarking agent memory

This benchmark measures steady-state physical memory for idle, fully composed coding agents. It separates the empty Host, the first agent plus its tool composition, and the incremental cost of additional live agents in the same Host. It makes no model request and needs no provider credential.

## Prerequisites

Build the Host artifacts and use Python 3.11 or newer on Linux or macOS:

```sh
pnpm run build:lib
python3 --version
```

Linux exposes proportional set size (PSS), the metric in [jcode's published comparison](https://github.com/1jehuang/jcode#performance--resource-efficiency). macOS exposes `phys_footprint`; the two metrics are not interchangeable, so compare tools only when they ran on the same operating system and machine.

## Measure DSH

Run the shipped Web composition at 0, 1, 2, 4, 8, and 10 agents:

```sh
pnpm run benchmark:memory -- --tool dsh --json-out /tmp/dsh-memory.json
```

The runner creates an isolated `DSH_HOME`, disables telemetry, boots the built Web CLI on an ephemeral loopback port, and mounts the shipped `standard` preset. The first agent activates that preset's standing composition and complete tool catalog; later agents join the same composition. Every agent remains live while later phases run. The default retained-state mode requests a full V8 collection before each phase so startup garbage and collection timing do not masquerade as agent growth; pass `--no-dsh-force-gc` to observe natural runtime collection separately.

Use `--dsh-preset <id>` to measure another shipped preset. The default ten-second idle window deliberately measures retained background state rather than startup transients. Use `--counts`, `--samples`, `--settle-seconds`, and `--sample-interval-seconds` only when the comparison run uses the same values.

## Compare with jcode

Install jcode or pass an explicit binary, then run both tools under one protocol:

```sh
pnpm run benchmark:memory -- \
  --tool both \
  --jcode-bin /absolute/path/to/jcode \
  --json-out /tmp/dsh-jcode-memory.json
```

The jcode path follows its [upstream memory runner](https://github.com/1jehuang/jcode/blob/master/scripts/bench_memory_cli.py): an isolated shared server owns one retained interactive PTY client per session, telemetry is off, and `JCODE_MEMORY_ENABLED=0` disables local memory embeddings. Each client must render a connected session screen before sampling. Its stdout remains a real PTY while stderr is non-interactive so platform setup hooks such as the macOS global-hotkey installer cannot mutate the host or add an unowned background process. Pass `--jcode-memory` for a separate embeddings-enabled result; do not combine enabled and disabled runs in one slope.

DSH's Web renderer is not part of the Host process tree, while every jcode terminal client is included. This matches the background-agent workload: DSH keeps many sessions in one Web Host without requiring one renderer per agent, whereas jcode's published session total includes its shared server and lightweight TUI clients. State this difference beside any comparison.

## Read the result

The terminal table and JSON name every metric. Linux uses the sum of `/proc/<pid>/smaps_rollup` PSS across the closed process tree. macOS uses `footprint`'s shared-page-adjusted summary for the same tree. RSS is recorded as a diagnostic and can overcount shared pages.

The report derives two different costs:

- `firstAgentAndToolMountBytes` is the 0-to-1 delta. For DSH it includes the first standing preset mount and tool implementations, so it is not a recurring per-agent cost.
- `addedAgentSlopeBytes` is `(memory at maximum agents - memory at one agent) / (maximum agents - 1)` when that process-tree signal is non-negative. A negative endpoint observation means page reclamation exceeded the retained-agent signal, so the report leaves this field unresolved instead of calling the negative value agent memory. This is the value comparable to jcode's “Extra PSS per added session” when resolved.
- `retainedHeapSlopeBytes` is DSH's post-collection live JavaScript heap growth over the same endpoints. It diagnoses a recurring agent cost below process-tree measurement noise but is not interchangeable with whole-process PSS or physical footprint.

Raw samples remain under every phase in the JSON. Record the tool versions, operating system, machine architecture, counts, sample window, preset, jcode memory mode, and primary metric with a published result.

## Limits

This benchmark measures ready but empty sessions. Long transcripts, model responses, tool output, terminals, language servers, browser processes, MCP servers activated only by local configuration, and allocator behavior after sustained work need separate workload phases. The default DSH result is retained memory after explicit V8 collection, not its transient high-water mark. A historical peak, one process's RSS, or the 0-to-1 delta does not establish recurring per-agent memory.

The benchmark process closes ownership over descendants and process groups so a tool cannot move work outside the measured tree. It uses isolated homes to exclude personal plugins, sessions, credentials, and caches; use a separate explicitly labelled run to measure a production profile. The rationale and rejected measurement shortcuts are recorded in the [process-tree memory benchmark Agent Note](../../.agents/notes/implemented/testing/2026-08-21-process-tree-agent-memory-benchmark.md).
