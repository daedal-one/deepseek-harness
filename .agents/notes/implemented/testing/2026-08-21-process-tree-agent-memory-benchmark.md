# Agent Note: Process-tree agent memory benchmark

Status: implemented

## Problem

A coding harness does not have one meaningful “RAM per agent” number. The Host and tool implementations contribute a fixed baseline, DSH presets mount one standing composition shared by many agents, auxiliary tools may run in child processes, and resident set size overcounts shared pages. Measuring one process after one session conflates fixed tool cost with recurring agent state and cannot be compared with a multi-session harness that reports proportional set size for its complete process tree.

## Decision

[`scripts/benchmark_agent_memory.py`](../../../../scripts/benchmark_agent_memory.py) measures one closed process ownership set at 0, 1, 2, 4, 8, and 10 retained sessions. Descendant and process-group closure includes helper processes. Linux sums `/proc/<pid>/smaps_rollup` PSS and records RSS; macOS records the shared-page-adjusted `footprint` summary and process-tree RSS. Raw samples and their metric names remain in a versioned JSON result.

The DSH run boots the built Web profile with an isolated harness home, telemetry disabled, an ephemeral loopback port, and a benchmark-only overlay. The overlay waits for the complete Loader tree, then retains fully composed agents on the selected shipped preset and assembles each system prompt once so tool schemas and scoped prompt contributions are warm. It invokes no model and preserves every earlier agent through the largest phase. The standard preset's first standing mount is therefore part of the 0-to-1 delta; later agents reuse it. Retained-state runs expose V8's collector and collect reclaimable garbage before every phase by default because unrelated collection timing otherwise makes the one-to-many slope non-monotonic; natural-collection runs remain available as a separately labelled mode.

The jcode run follows its public memory methodology: an isolated shared server plus one interactive PTY client per retained session, telemetry disabled, and local memory embeddings disabled unless the run explicitly enables them. Each stdout PTY must render a connected session screen. Stderr stays non-interactive because jcode's macOS setup path otherwise installs a global hotkey helper outside the benchmark ownership set. The result states that DSH has no per-session Web renderer in the measured Host tree while jcode includes each terminal client.

Reports keep the first-agent-and-tool delta separate from the added-agent slope. The recurring process-tree value is the one-to-maximum difference divided by the added session count when that signal is non-negative; a negative endpoint observation remains raw evidence but is reported as unresolved page-reclamation noise. DSH also reports its post-collection retained JavaScript-heap slope as a diagnostic rather than treating it as whole-process memory. Linux PSS comparisons never use macOS physical footprint or RSS as a substitute.

## Alternatives considered

**Report `process.memoryUsage().rss` from the Node Host.** This omits child processes, overcounts shared pages differently from jcode's PSS result, and hides the large macOS difference between current RSS and physical footprint. The Node counters remain available as a diagnostic marker but do not own the headline metric.

**Call the 0-to-1 delta “per-agent memory.”** The first DSH agent activates the shared preset and tool implementations, so that delta is a fixed coding-surface cost plus one agent. Separating it prevents a one-time tool mount from being multiplied across background agents.

**Benchmark independent Headless processes.** One complete process per task measures process isolation, not the shipped in-process subagent and multi-session Web architecture. The retained shared Host is the relevant workload for background agents; independent-process measurements can be added as a separately named mode if deployments use that provider.

**Compare DSH macOS RSS with jcode's published Linux PSS.** The metrics and kernels account shared and compressed pages differently. The runner supports both platforms so each comparison uses one machine and one primary metric.

## Consequences

Contributors can reproduce fixed tool cost and recurring idle-agent growth without credentials or a model call, preserve raw evidence, and compare a local jcode binary under the same phase schedule. The benchmark also makes process topology visible through the per-phase process count.

The result describes empty warm agents, not long-session retention or active tool workloads. macOS comparisons use physical footprint rather than the Linux PSS number published by jcode, and jcode includes PTY clients that DSH's background-agent Host does not require. Benchmark execution remains opt-in because process inspection and repeated physical-footprint sampling are platform-specific and slower than ordinary tests.
