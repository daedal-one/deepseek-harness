---
description: "Private opt-in sequential operation plans that dispatch existing tools through bounded semantic checkpoints and durable replay records."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-operation

## Summary

`dsh-experimental-operation` lets a model submit one short, finite plan through `run_operation` when a composition explicitly mounts it. The runner executes eligible tools sequentially, preserves canonical result values, and checks deterministic assertions before asking a configured provider to rank complete next actions. A run can complete, stop, or return control for replanning, and its recorded decisions can be replayed without executing tools. The package is private and experimental; no production tool is eligible by default.

## Table of Contents

- [Use this package](#use-this-package)
- [Operation-only coding composition](#operation-only-coding-composition)
- [Durable records and replay](#durable-records-and-replay)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Mount this service beside `dsh-tools`, durable Session persistence, and a provider such as [operation-clm](../operation-clm/README.md). The following composition illustrates the required identity fields; deployment owners supply reviewed values and the matching tokenizer rather than using these placeholders.

```yaml
- name: '@deepseek-ai/dsh-experimental-operation'
- name: '@deepseek-ai/dsh-experimental-operation-clm'
  config:
    endpoint: https://clm.example.invalid/v1/systemone
    tokenizerId: qwen3-8b
    model: clm-v0.1-8b
    encoder: qwen3-8b@sha256:replace-me
    deployment: sha256:replace-me
    deploymentManifest:
      reference: registry.example.invalid/clm-deployments/production.json
      digest: sha256:replace-me
    temperature: 1
    maxEncoderTokens: 2048
```

The composing deployment registers the exact tokenizer hook named by `tokenizerId` before mounting the CLM provider and supplies its independently reviewed `calibrationId`; the incomplete example neither qualifies a model nor authorizes autonomous execution. Its `maxEncoderTokens` must match the reviewed serving deployment's encoder ceiling; the example is not a default. The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-operation) owns the complete runner limits.

The deployment also registers an explicit trusted policy through `ctx.operations.toolPolicies` for each exact `ToolDefinition` instance eligible for operation execution. Each policy explicitly declares `allowOutputReferences`; process policies set it to false so only literal/input-derived arguments are admitted, while a reviewed structured-selection fixture may enable it. A matching name, schema, model description, or prior definition registration grants no operation authority. The foreground-process helper checks lifecycle facts, not command safety; ordinary permissions authorize commands, and read-only compositions additionally restrict invocations.

`run_operation` accepts a goal and nonempty fixed steps with ordinary tool argument objects. The runner resolves this concise request into an immutable version-one program with step identities, literal arguments, result-presence checks, observations, and completion evidence. Omitted `observe` selects the complete canonical result; an explicit nonempty JSON Pointer list selects complete necessary values. Detailed version-one programs support typed references and custom assertions. Invalid or mixed forms fail before dispatch. Every planned tool is admitted against the calling agent's current scoped visibility and deferred discovery state before the first dispatch. Admission requires the trusted exact-definition policy, validates statically known argument leaves, and rejects paths or argument types that the declared schemas prove impossible. Unknown or permissive schemas still require concrete runtime validation; they are not evidence that a reference exists. The same definition, schema, and policy registration are rechecked before each effect. Every synchronous argument-policy call receives a fresh frozen `OperationToolCallerContext` containing only the actual caller Session's `cwd`, never plan-supplied context or a server-process fallback. The runner pins that initial cwd and rejects drift before preparing a step or entering its body, including across asynchronous approval. Concrete calls still pass through the ordinary registry policy, approval, credentials, sandbox, and cancellation pipeline. Assertions and completion evidence can reuse the actual accepted selection when the current step's arguments select that preceding record; an assertion alone cannot create a selection.

## Operation-only coding composition

The scoped `./agent` plugin selects `operation` presentation and binds configured underlying tools to their exact current definitions. `tools: all` captures the composition's complete inventory except recursive operation/program transports; an explicit list narrows it. An unavailable definition, duplicate entry, or unscoped mount fails. Replacing a captured definition does not transfer its policy. The planner receives a bounded complete catalog of admitted action schemas and concise operation guidance; catalog overflow rejects assembly rather than dropping actions. See the [user guide](../../../docs/user/operation-only.md) and [composition fragment](../../../apps/cli/config/examples/operation-only.agent.yml).

The coding policy allows complete selected read windows, ordinary search, and literal small `write`/`edit` inputs bounded by `maxMutationBytes`. Combined old/new edit bytes count toward that limit. Shell and mutation arguments cannot refer to preceding tool results; complete structured read/search references remain possible. Foreground shell results require settled successful execution and complete streams. Other explicitly composed actions retain ordinary schema and permission checks; pending or background results cannot establish completion. Generic admission is not independent semantic certification of arbitrary plugins.

Mount the runner and provider inside a preset group isolating both `operations` and `operationJudgments`. The `./agent` plugin owns this scope's presentation selector, so do not mount another selector in the same scope. `returnObservations: true` returns the last complete declared observations to the planner within `maxObservationBytes`; false preserves a status-only result. Observations are canonical JSON values, logged through the outer result, and do not reconstruct binary attachment content. The independent [Decision Engine](https://github.com/daedal-one/decision-engine) runs outside the DSH process; model calibration remains a separate declaration.

## Durable records and replay

The package writes required, log-only `operation/*` records for admission, step intent and canonical results, judgment requests and responses or failures, transitions, and terminal outcomes. Admission also records the caller Session and outer call, effective configuration, and tool schemas. Canonical argument, result, schema, and judgment-evidence fingerprints correlate the values consumed at each checkpoint. These digests detect inconsistent recorded facts; they do not authenticate a deployment or grant execution authority. The [persistence catalog](../../../docs/persistence-catalog.md) owns the declarations.

The runner flushes each settled tool or judgment outcome before terminal handling, flushes the judgment request before provider inference, and flushes a selected transition with the next step intent before that next tool dispatch. Provider-prepared encoding evidence and parsed response facts remain in those records when the provider supplies them.

`replayOperation()` reconstructs the selected run without calling tools, models, or the filesystem. Every step after the first requires a recorded accepted continuation whose selected canonical source and resolved arguments match its intent. Completed replay requires an accepted final `complete` choice, matching recorded and reevaluated completion checks, and exact attempted/completed step lists. It rejects transitions that do not match their recorded request and response candidate mapping. Valid record prefixes remain replayable. A step intent without a settled result has unknown dispatch and outcome; a settled cancellation or deadline after body entry retains an unknown outcome even when the tool returns its own error code. The effective body signal covers ordinary timeout-policy and wrapper cancellation independently of the caller and operation-owned deadline. Recorded pre-dispatch rejection remains distinguishable from a started body. Legacy records without the optional fingerprint and execution fields remain readable without inventing those facts, and no operation is automatically resumed.

The [keyless SDK scenario](../../../snapshots/sdk/clm-operations/snapshot.yml) patches the shipped SDK profile with this service, verified read-only fixture tools, and a deterministic judgment provider. Its recorded Session drives the TypeScript and [Python SDK projection](../../../python/sdk/tests/test_client.py) evidence; it does not exercise a live CLM deployment or establish ranking quality.

## Further Exploration

- [Tool execution](../../../docs/subsystems/tools.md) — scoped tool visibility and ordinary dispatch policy.
- [Operation types](src/types.ts) — plans, `OperationJudgmentProvider`, `OperationTokenizer`, and terminal `OperationSummary` declarations.
- [CLM adapter](../operation-clm/README.md) — deployment identity, encoding, and HTTP validation.

## Model Experience

### Operation plans and summaries

#### What the model sees

An opted-in composition exposes `run_operation` with a structured JSON `plan` argument. The preferred form requires only `goal` and `steps`, with each step containing `tool` and plain `arguments`. Optional `observe` selects complete evidence. The harness supplies execution bookkeeping and deterministic presence checks; trusted process checks and semantic completion remain mandatory. The detailed form requires version-one fields and supports typed expressions and custom assertions. The resolver validates closed fields, recursive expressions, nonempty collections, references, and numeric limits without a recursive schema ceiling. The tool returns a bounded terminal summary with the run identity, status, attempted and completed steps, and declared verification outcomes; detailed checkpoints remain log-only, while `returnObservations` optionally returns the last declared canonical observations. The [tool definition](src/index.ts) owns the argument and result declarations.

##### Operation tool description

```markdown
Execute one short, finite operation plan through existing tools. Only tools explicitly admitted by the composing profile are accepted; ordinary permissions still apply. Make this the only tool call in the assistant response. Supply plan:{goal,steps:[{tool,arguments}]} with ordinary tool arguments. The harness supplies execution bookkeeping and checks; optional step.observe selects complete evidence. Detailed version-one programs remain available for explicit references and assertions. The runner executes steps sequentially, records every checkpoint, and may return needs-replan or stopped instead of inventing values. Use foreground actions and literal small edits. Do not use this tool for background jobs, automatic retries, output-derived shell or edit arguments, or recursive operation plans.
```

#### Token effect

The planning request gains the structured `run_operation` declaration, scoped planning guidance, admitted action catalog, and returned summary. A compatible admitted bash action also receives the executable one-step repository-status example. Checkpoint details remain outside planning-model history unless selected as returned observations. The judgment provider receives only the bounded canonical observation and complete candidate actions recorded for that checkpoint; its separately counted input is rejected beyond the frozen budget rather than truncated.

#### KV Cache effect

The opted-in tool declaration changes the planning request's tool catalog. Operation checkpoints do not append planning-model messages or mutate its cached history; the outer tool result extends that history through the ordinary loop.

## Known Limitations and Deferred Work

The initial operation language and deployment policy intentionally restrict execution.

- Plans are strictly finite and sequential: no retries, branches, DAGs, background work, nested operation runs, compensation, or restart continuation.
- Evidence consists of complete JSON Pointer values and arrays of complete JSON candidate records; the runner does not parse arbitrary stdout, CSV, or command text.
- This service grants no tool eligibility itself. The separate [operation-fs](../operation-fs/README.md) opt-in owns reviewed production read/search definitions; other deployments must register each exact reviewed definition and structured result inspector. Background handles, incomplete output, and mandatory process failures cannot be normalized into completion.
- A passing declared completion check is evidence for the plan only, not independent proof of an arbitrary natural-language goal.
- Shipped profiles do not mount the package by default. It has no Operations mode or UI, and deterministic profile evidence does not establish CLM quality or live-provider performance.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published because the runner validates admission, source bindings, and recording barriers before dispatch, and replay validates the recorded transaction without maintaining a second live projection. There is no independently maintained observation to compare through a `./invariant` entry.

</details>
