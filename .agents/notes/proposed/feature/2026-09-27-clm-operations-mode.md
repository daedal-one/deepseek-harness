# Agent Note: Execute operation plans with CLM continuation judgments

Status: proposed

## Problem

An agent often knows several operations ahead but still spends a full model request interpreting each intermediate result and choosing the next command. Programs can reduce those requests, yet human-oriented output encourages brittle parsing, while unexpected results require reasoning that a deterministic script cannot supply. The desired behavior is to author a bounded sequence once, execute it through the normal tool system, and use a fast model to decide whether the observed result supports the next operation and which observed values belong in its arguments.

DSH already provides canonical JSON tool results, generated programmatic bindings, guarded nested execution, and cancellation. Those facilities are owned by the [tool registry](../../../../packages/core/tools/README.md), the [canonical output decision](../../implemented/architecture/2026-07-20-canonical-tool-output-contract.md), and [typed PTC returns](../../implemented/feature/2026-07-20-ptc-typed-tool-returns.md). The missing behavior is a runner-owned checkpoint between operations that combines deterministic validation, semantic selection, and an explicit return to the planning model.

## Proposal

Introduce an opt-in `run_operation` tool backed by a small sequential runner and a replaceable judgment service. The planning LLM submits a validated plan containing tool names, argument expressions, expected results, evidence selection, and completion checks. The runner executes existing registered tools. After each successful step it checks the result, constructs admissible continuations with fully resolved arguments, and asks CLM to choose one or return control to the planner. Known failures stop before inference. The runner never lets the judgment provider generate commands, synthesize missing values, or change permissions.

The first implementation is the **Dike** experiment: short sequential plans, observation and selection, a CLM provider, durable decision records, and replay. A dedicated Operations mode follows only if Dike demonstrates a benefit over existing PTC execution. Runtime behavior is not implemented by this proposal. The [draft requirement](../../../../.specs/tools/operations.spec.md) owns proposed obligations; the [draft implementation task](../../../../.specs/tasks/clm-operations.spec.md) tracks the first implementation slice. Both remain draft until implementation is selected.

### Reading order

Read [Scope and ownership](#scope-and-ownership) for product boundaries, [Plan contract](#plan-contract) and [Execution protocol](#execution-protocol) for implementation, [Judgment and output selection](#judgment-and-output-selection) for the model interface, and [Dike evaluation](#dike-evaluation) for the experiment and promotion criteria.

## Scope and ownership

The first runner supports a finite ordered list of steps. It executes each step at most once, has one outstanding tool or judgment request at a time, and either advances to the immediately following step or terminates. A selection can change declared argument values for that next step; it cannot change the next tool, reorder the sequence, skip verification, or introduce a loop. Dynamic branching, parallel execution, background jobs, nested operation runs, automatic retries, compensation, and process-restart continuation are deferred.

| Owner | Responsibilities |
|---|---|
| User and existing permission system | Goal, accessible execution environment, credentials, permissions, and approvals |
| Planning LLM | Step sequence, fixed tool names, argument expressions, semantic questions, and declared completion evidence |
| Operation runner | Validation, binding resolution, deterministic checks, candidate construction, bounds, state transitions, and recording |
| Existing tool registry and providers | Argument validation, scoped tool availability, policy, execution, cancellation, canonical results, and actual effects |
| Judgment service | Scores a supplied observation against a closed candidate set |
| Evaluator | Hidden task truth, correct selections, final-world verification, and experimental comparison |

Use the calling agent's context and workspace for every dispatch. A plan's effect description is explanatory metadata, never an authorization fact. A provider timeout, an uncertain judgment, or a failed assertion cannot cause a permission escalation. Existing approval behavior applies to the concrete tool arguments at dispatch; this feature adds no blanket approval requirement for all mutations.

The initial live evaluation uses independently verified read-only fixtures and tools. A tool described as read-only by the planning model is not sufficient to enter that evaluation. Repository inspection commands must not execute project-defined scripts or hooks as a side effect of the fixture. Mutation support is a later milestone with observable postconditions and the existing policy checks.

## Existing foundations and proposed components

The operations implementation must depend on service definitions and documented extension points described by [architecture](../../../../docs/architecture.md). It does not require an agent-loop change. The [workflow engine](../../../../packages/workflow/workflow/README.md) remains the script-based subagent orchestration facility; this runner consumes ordinary tools directly. The [capability roles decision](../../implemented/architecture/2026-06-13-capability-seams.md) permits combining roles when they evolve together.

Start with two private experimental packages, provisionally named `dsh-operation` and `dsh-operation-clm`. The first contains the operation types, validation, sequential runner, event vocabulary, tool consumer, and a Cordis judgment service definition. The second supplies the CLM HTTP provider. Tests supply a deterministic provider behind the same service. Keep a single configured provider per composition initially; consumers do not import CLM-specific wire types. Split the judgment definition into an independent package only when another production consumer needs it.

The proposed judgment service has one operation: rank a bounded request under a caller-owned cancellation signal and return scores plus provider identity. It has no generation, tool execution, memory, approval, or plan-editing method. It accepts a request that is already complete and budgeted; configuration resolution belongs to the provider before dispatch.

Reuse `ctx.tools.execute` for sequential nested calls, propagating the agent, root call identity, parent token, and caller cancellation. Do not import the PTC scheduler's internal symbol or copy its concurrency machinery. Forward additional contexts and successful terminal markers according to the composite-tool contract. A terminal marker ends the operation after the current tool settles; it cannot be ignored while later planned steps execute. Exclude recursive `run_operation`, unrestricted program runners, background/delegation tools, and composition-mutating tools from the initial operation policy.

Run admission resolves the current agent-visible tool set, including discovery restrictions. Missing or undiscovered tools cause admission to fail before any step starts. Each step rechecks availability and its input/output schema identity before dispatch. A changed schema or unloaded provider ends the run for replanning; runtime permissions still receive their normal current-state checks.

The existing [checkpoint policy](../../../../packages/session/session-checkpoint-policy/README.md) flushes top-level calls and lets nested calls reuse the outer checkpoint. Operations require additional checkpoints for their own judgments and selected actions, described in [Recording and replay](#recording-and-replay). Reusing the outer checkpoint alone cannot make intermediate choices durable.

## Plan contract

The model-facing input is versioned JSON, not executable code. Implement the parser with the repository's enforced schema vocabulary. The table below specifies proposed fields without claiming a shipped TypeScript API.

| Field | Meaning |
|---|---|
| `version` | Initially `1`; unsupported versions reject |
| `name`, `goal` | Bounded descriptive strings; the goal accompanies semantic questions |
| `inputs` | Immutable JSON values supplied when the run begins |
| `steps` | Nonempty ordered list with unique step IDs |
| `completion` | Nonempty deterministic assertions over final recorded results, plus a semantic completion question |
| `requestedLimits` | Optional tighter limits; a plan cannot raise deployment ceilings |

Each step contains an ID, purpose, fixed registered tool name, argument expressions, required result assertions, explicit observation selectors, and a semantic checkpoint question. The next step's argument expressions may refer to inputs or completed earlier steps. Completion evidence must identify the results that support it. Model-authored checks define the plan's claimed outcome; their passing does not independently prove that an arbitrary natural-language goal has been satisfied.

### Argument expressions

Use a tagged expression representation so literal strings and objects cannot accidentally become executable references. The initial kinds are `literal`, `input`, `result`, `selected`, `object`, and `array`. An `input` names an input plus a JSON Pointer; a `result` names an earlier step plus a JSON Pointer into its canonical result; a `selected` names the immediately preceding step's checkpoint plus a JSON Pointer within the record it selected. The planner refers to that selection site, while the runner assigns candidate IDs after observing the result. Composite object and array expressions build only JSON values. There is no `eval`, arbitrary function, string interpolation, shell concatenation, or general query language.

References are resolved without coercion. Missing fields differ from explicit JSON `null`; missing fields, wrong types, and failed constraints stop the run. Paths are evaluated as JSON Pointers, not host-language property expressions. Operation run IDs, step IDs, candidate IDs, and request IDs become branded types internally and are validated at JSON or persistence boundaries.

Admission checks reference ordering, duplicate IDs, unsupported expression kinds, static tool names, every known schema constraint, limit feasibility, and required verification. Static checking of a referenced value may be incomplete for open or union output schemas; the runner repeats full argument validation against actual resolved values before each dispatch. A schema-valid string does not establish that a path or URL is permitted: existing tool policy remains authoritative.

### Deterministic assertions

Start with presence, JSON type, exact equality, membership in a finite set, numeric bounds, collection size, and equality between referenced values. Domain assertions such as a file revision match belong to trusted tool or observation adapters that can obtain authoritative facts. Do not implement a new general expression language or plan-authored parser library.

Separate required runtime checks from plan assertions. Cancellation, registry denial, tool failure, runner failure, invalid canonical output, recording failure, and exhausted limits are unwaivable. A shell observation adapter additionally interprets `timedOut`, `aborted`, termination signal, and sandbox denial/runner failure independently of `exitCode`. An expected nonzero code, such as an explicit no-match result, is legal only when the plan declares that outcome and its assertions pass. CLM cannot turn a failed required check into success.

A foreground process result and a background job handle are different outcomes. A job handle is not completed work and is rejected by the first runner. The initial plan policy also rejects interactive terminals and operations whose progress requires asynchronous polling.

### Effective limits and frozen identity

Deployment configuration owns plan bytes, step count, wall time, individual tool and judgment deadlines, total judgment count, canonical-result bytes, observation tokens, candidate count, candidate tokens, evidence bytes, and inference-token or provider-usage ceilings where measurable. The planner may request lower limits. Resolve the complete effective configuration before the run begins and record it with a configuration digest.

Freeze the admitted plan, schema fingerprints, initial input values, relevant execution-context identity, and resolved configuration in the run-start event. Compute a deterministic digest from canonical JSON using an existing repository utility or maintained library. This digest identifies what was admitted; it grants no execution authority. A new plan or changed observation recipe creates a new run identity.

## Execution protocol

The runner owns transitions and accepts no external direct state mutation. The first tool has no predecessor checkpoint, so it starts after admission, deterministic argument checks, recording, and ordinary tool policy.

1. Validate the plan and selected tool definitions. Reject admission without executing any tool if the plan is invalid.
2. Record run admission and resolved limits. Resolve the first tool's arguments and record a step start before dispatch.
3. Flush the calling session, recheck cancellation and remaining budgets, then dispatch through the complete tool pipeline. An operation-specific recording failure prevents dispatch.
4. Await tool quiescence. Preserve the canonical result and independent execution flags; forward any additional contexts. A cancellation or required execution failure records the available step outcome and ends the run without CLM inference; if recording itself fails, stop through the infrastructure-error path.
5. Record the result and evaluate required assertions. Failed assertions produce an explicit stop with evidence. Pending or incomplete work is never normalized to success.
6. Build the declared observation and, when another step exists, its complete candidate actions. Reject invalid or missing bindings before ranking. If the next operation cannot be assembled with sufficient evidence, end with `needs_replan`.
7. Record and flush the exact judgment request, including rendered semantic descriptions and candidate-to-value mapping. Invoke the configured provider under the remaining budget.
8. Validate the response, calculate the configured acceptance rule, and record the decision. Unknown candidate IDs, incomplete distributions, expired requests, and provider identity changes are failures, never default continuation.
9. For a selected continuation, resolve that candidate's exact arguments from the recorded mapping, validate them again, record the binding and next step start, and flush before dispatch. Only then can the next tool enter its policy pipeline.
10. After the final tool, run completion assertions and a final semantic checkpoint. Record the terminal outcome and flush before returning the operation summary to the planner.

Successful intermediate results therefore always receive a semantic checkpoint in the first CLM arm, including steps with one possible continuation. Hard failure skips inference. The final checkpoint offers completion, semantic stop, and return-to-planner choices only when deterministic completion assertions pass. Low confidence, missing evidence, or a semantic stop never silently becomes completion.

| Outcome | Meaning and control transfer |
|---|---|
| `completed` | All steps and declared completion checks passed; return evidence for the planning LLM's user-facing answer |
| `needs_replan` | Execution is quiescent but the plan lacks a supported continuation or the judgment abstained; return evidence and the unresolved decision |
| `stopped` | A declared assertion or semantic checkpoint rejected continuation; return the failed condition and partial results |
| `failed` | Infrastructure, schema, recording, provider, or limit failure; preserve a coded failure and partial evidence |
| `cancelled` | Caller cancellation won; perform no further dispatch and await owned cleanup |

Expected `completed`, `needs_replan`, and `stopped` results are distinct canonical tool values with explicit rendered status. Infrastructure failures use the registry's normal error path after recording the available run outcome. Cancellation retains the registry's cancellation semantics. A missing terminal event after process loss means interrupted or outcome unknown, never completed. Late provider responses cannot revive a stopped run.

## Judgment and output selection

### Observation construction

An observation contains the goal, current step purpose, normalized execution facts, selected evidence, passed assertions, the proposed next tool's purpose, and completeness metadata. The runner constructs it from recorded canonical values after post-execute policy; it does not parse the human-readable tool renderer. No full session transcript is sent by default.

Evidence selectors are part of the frozen plan. The first version supports JSON Pointer reads, bounded array records, and complete text or line records with provenance. Text splitting identifies complete source spans; it does not infer arbitrary values inside sentences. Existing format-owned parsers may be registered as trusted adapters when a real task requires one. JSON decoding must consume a complete bounded value and reject trailing non-whitespace, malformed input, and incomplete capture. Further CSV or domain decoders are added with task evidence, rather than as a general parser catalog.

Every candidate retains its source step, JSON Pointer or exact text span, original value, schema identity, and evidence digest. Selection never rewrites the candidate's value. A CLM description is a readable rendering of the actual value and relevant source evidence; the dispatch uses the original typed value. If the correct answer cannot be expressed by the supported extraction, the runner returns to the planner. A generative extractor may be evaluated later, with separate cost and provenance requirements.

A truncated stream or oversized observation must not be silently presented as complete. A trusted adapter may establish that a complete structured field is independent of an unrelated truncated stream; otherwise the runner returns `needs_replan` with the missing evidence. Do not silently keep only the first candidates when a collection exceeds the cap. The planner can add an explicit earlier filtering or inspection operation in a replacement plan.

For the initial provider, token accounting must cover the final serialized state-plus-instructions and every candidate description using the pinned encoder's tokenizer. If exact accounting is unavailable, fail the compatibility preflight instead of assuming a byte estimate prevents server truncation. Provider truncation is disabled or detected and rejected. Evidence restriction and redaction happen before recording the exact outbound payload; a redaction that removes necessary decision information ends the attempt.

### Complete action candidates

Prefer one selection over complete records. If the next tool needs a path and revision, each candidate carries both from the same observed record. This avoids selecting a path from one artifact and a revision from another. Reject a plan that independently selects incompatible fields or would require an unbounded Cartesian product. In the first version, one candidate collection supplies all semantically selected arguments at a checkpoint; fixed inputs and deterministic references may accompany it.

The runner renders each candidate as a concrete next action, including the fixed tool name, resolved arguments, purpose, and selected evidence. The action head receives that meaningful description while an opaque candidate ID remains the response key. Model output is accepted only if it refers to one of those exact keys. Reserved runner-owned stop and replan candidates are always present; their meaning cannot be changed by plan input.

For example, a search tool could return these fixture records:

```json
[
  { "path": "packages/api/package.json", "role": "API package", "revision": "r17" },
  { "path": "packages/web/package.json", "role": "Web package", "revision": "r23" }
]
```

If the goal asks to inspect the API package, each ranked continuation contains the corresponding complete `path` and `revision` binding. CLM selects a record; the runner constructs the next tool request. The example is fixture data, not a claim about actual package paths or a registered tool's schema. Output-derived values may fill declared structured argument positions. They may not be interpolated into a shell command string in the first version; shell commands remain literal. A separately policy-integrated argv tool would need its own design if real workloads require dynamic process arguments.

### Provider request and response

The first adapter uses CLM's `choice` question with `instructions` and a `criteria` mapping. An illustrative request is:

```json
{
  "state": {
    "goal": "Inspect the API package manifest",
    "lastStep": "locate-packages",
    "execution": "completed",
    "evidenceComplete": true,
    "assertions": "candidate records have path, role and revision"
  },
  "questions": {
    "transition": {
      "type": "choice",
      "instructions": "Choose the next action supported by the goal and evidence. Return control when evidence is insufficient; stop when continuation contradicts the goal.",
      "criteria": {
        "candidate-0": "Inspect packages/api/package.json at observed revision r17; record role: API package.",
        "candidate-1": "Inspect packages/web/package.json at observed revision r23; record role: Web package.",
        "needs-replan": "Return control to the planner because no proposed action has sufficient support.",
        "stop": "Stop because continuing this plan contradicts the goal or observed result."
      }
    }
  }
}
```

Validate HTTP status, bounded body size, JSON shape, question identity, candidate identity, finite scores, complete candidate coverage, and normalized probabilities with an explicit numerical tolerance. Record the full validated distribution. Calculate the top probability and top-versus-runner-up margin locally; the upstream field named `confidence` uses a different formula. The provider may return usage and timing metadata, but runner-measured wall time remains the latency authority.

CLM is a candidate ranker and its probabilities are relative to the supplied choices. It does not expose a reliable general-purpose uncertainty detector merely because an abstention option exists. Thresholds are calibrated on held-out decision families and candidate-set sizes; a missing calibration uses shadow evaluation or returns to the planner. Continuation and completion require the calibrated acceptance rule; a low-confidence response returns `needs_replan` and cannot authorize an action. Model, encoder, pooling, tokenizer, quantization, serialization recipe, and candidate-description changes invalidate the relevant calibration.

The [upstream schema](https://github.com/Contrastive-LM/CLM/blob/main/src/clm/schema.py) owns the external request format. The [model card](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B) states that the released head requires the matching Qwen3-8B encoder and does not generate text. These are inspected upstream interfaces, not locally exercised inference evidence. Pin the serving implementation and model artifacts during provider implementation; do not treat the moving `clm-latest` alias as an immutable model identity. A deployment manifest must bind the endpoint to immutable artifact digests and disable changes during a run; an API model-name field alone cannot establish those facts. Unverifiable model identity prevents autonomous execution while still allowing clearly labeled shadow evaluation.

## Recording and replay

Use operation-owned, log-only session events with explicit schema validation and projection. The exact event names remain implementation vocabulary; the required facts and ordering are:

| Record | Required contents |
|---|---|
| Run start | Run/root/parent identity, frozen plan and digest, resolved limits, caller execution context, tool schema fingerprints, provider/calibration identity |
| Step start | Step identity, nested tool call identity, exact resolved arguments, binding provenance |
| Step result | Canonical post-policy value or bounded immutable artifact reference, rendered outcome for existing presentation, execution flags, error, elapsed time |
| Judgment request | Exact semantic input, serialized question and descriptions, complete candidate mapping, token counts, remaining limits, provider identity |
| Judgment result | Request identity, response distribution or failure, usage, measured timings |
| Transition | Selected candidate and bindings, deterministic acceptance-rule result, continuation or stop reason |
| Run end | Terminal status, completed and attempted steps, verification evidence, accumulated usage, unresolved effect if any |

Append the request before sending it to any auxiliary model and use `ctx.sessions.flush(session)` to establish persistence. Append and flush the selected transition plus the next step start before dispatching that next effect. Flush the terminal record before returning a normal result. The result of the preceding tool can share the next judgment-request flush; avoid unnecessary extra fsync operations. Measure checkpoint time as part of end-to-end latency.

The initial implementation requires a calling agent session and composed persistence with a working flush barrier. It fails admission if those guarantees are unavailable. Immutable evidence artifacts, if used, must be durably stored before an event can refer to them, available under the same access controls, and retained with their referring run. For Dike's small fixtures, bounded inline values are sufficient; result-size overflow stops rather than introducing a new artifact store. Spill paths alone are not durable evidence.

Reuse PTC's correlation and composite-context semantics, but do not claim its rendered nested records contain every canonical value consumed by CLM. Operation events must store that value or the complete decision input explicitly. Workflow's best-effort presentation recorder is also insufficient: an operation recording failure must prevent later inference and execution, because the records justify those actions.

Replay folds recorded facts without calling CLM, executing tools, or checking the current filesystem. It reconstructs what happened and the exact values used. Rerunning judgments against recorded observations is a separate evaluation mode and must never overwrite the original decision. Resuming live work is deferred: opening an interrupted run presents its last known state and returns control to the planner. The [session format authority](../../../../docs/session-format-status.md) governs readers of new required events; existing committed generations remain untouched.

A persisted step start with no terminal result records an unknown outcome. Cancellation or connection loss cannot establish that an external mutation did not occur. A future resume design must use tool-supported deduplication or independent state reconciliation, not an assumed exactly-once property of run IDs.

## Planner handoff and product behavior

The `run_operation` description teaches the planner to submit short sequences with explicit verification and to make the operation call the only call in that assistant response. Guidance is not an enforcement guarantee. A later Operations mode must enforce sole-call operation batches through an existing agent extension point, reject invalid batches before any sibling call starts, and cover both Native and PTC transports. This is a mode-specific rule; it does not change ordinary agent behavior.

During the first experiment, the evaluator submits a single operation call and uses the existing tool presentation with explicit status. The runner returns a bounded summary containing run ID, completed and failed steps, selected outputs, verification results, stop code, and durable evidence references. It does not fabricate a natural-language explanation from CLM's scores; reason codes and failed deterministic conditions provide the explanation. The full LLM reads further evidence through normal authorized tools if needed.

`needs_replan` ends the current operation invocation. The planner may create a new short plan using already observed facts, but it must recheck state before relying on stale observations. A replacement is a new immutable run with a link to the preceding run. The experiment controller owns a total authoring/replanning budget across attempts, so a new run cannot reset the experiment's cost ceiling.

After the experiment succeeds, an opt-in `/operations` command can add logged authoring guidance and expose a replayable step timeline. It does not change the permission preset. The UI shows pending/running/completed/stopped/interrupted states, concrete selected values, failed conditions, and provider latency; expanded inspection contains score distributions and evidence. Host presenters stay pure, Client cards derive from persisted facts, and strings follow the repository's locale ownership. User cancellation reaches the active tool or provider and drains owned work before the outer invocation settles.

## Failure and lifecycle behavior

| Trigger | Required response |
|---|---|
| Invalid plan, hidden tool, unsupported schema, impossible reference | Reject before first dispatch |
| Tool denied or registry failure | Record failure and stop; do not ask CLM to reinterpret permission |
| Required assertion fails | Stop with assertion and observed value |
| Missing candidate, incomplete evidence, unsupported extraction | `needs_replan`; no invented binding |
| Semantic stop or low-confidence selection | Stop or return to planner as declared; no implicit default candidate |
| Provider outage, malformed answer, inference deadline | Coded provider failure; no silent model fallback or retry in the first runner |
| Budget expires or caller cancels | Abort the active request, stop scheduling, await quiescence, and retain partial evidence |
| Record append, artifact write, or flush fails | Stop before any following model request or tool effect |
| Tool or schema changes while awaiting judgment | Reject stale dispatch and return for replanning |
| Process dies after step start | Replay unknown outcome; do not restart the step automatically |

One run owns its cancellation controller, provider request, pending tool execution, and recorder. Follow [defensive patterns](../../../../docs/defensive-patterns.md) for first-terminal-outcome handling and disposal. Register contributions with Cordis effects; provider unload stops admitting new requests and cancels/drains owned requests under its documented lifecycle. No detached work may continue after a run reports terminal settlement. The runner cannot promise to hard-kill arbitrary same-process tool code; admitted tools must honor the existing cooperative cancellation contract.

Tool output is untrusted data even when it is valid JSON. It may contain text that attempts to influence the judgment. The runner keeps instructions separate, preserves source attribution, limits available continuations, and validates the resulting concrete call through existing policy. Evaluation includes adversarial output; closed-set selection reduces possible actions but does not make semantic judgments immune to manipulation.

## Dike evaluation

### Hypothesis and comparisons

The experiment asks whether CLM can handle semantic checkpoints and output selection at lower total task latency and cost than full-model decisions, while preserving externally verified task completion. It separately asks whether those gains exceed what ordinary programmatic tool execution already achieves. Retain the proposed name Dike for this experiment; no training or paid execution is authorized by writing this proposal.

| Arm | Mechanism | Question answered |
|---|---|---|
| A: ordinary agent | Full model may reason between tool calls | Current task-level baseline |
| B: existing PTC | Same model authors a program using current typed bindings | Benefit of batching without the new runner |
| C: deterministic plan | Same frozen plans and candidate observations as D; assertions and deterministic unique matches only, otherwise escalate | Benefit of CLM over the runner alone |
| D: CLM plan | Same frozen plans as C, with semantic continuation and complete-action selection | Incremental value of CLM |

Arms C and D share authoring outputs, tool implementations, candidate construction, and task instances. Arm C may not use hidden labels to choose a candidate. Arms A and B receive identical goals, initial state, tool access, and comparable authoring/replanning budgets, but do not pretend to share an execution policy they do not use. Count all authoring, planning failures, escalations, validation attempts, and final verification costs. No arm receives a human-written parser or task-specific hint unavailable to its peers unless that is a separately labeled oracle diagnostic.

### Stages and datasets

1. **Offline mechanism fixtures:** build 8–12 small task families covering structured selection, text record selection, correlated fields, expected nonzero results, omitted candidates, ambiguous output, and deterministic failures. Use deterministic provider answers to establish execution and logging behavior. This establishes software behavior only.
2. **Decision replay:** collect permitted observations with independent labels for candidate presence, valid transitions, selected records, and required escalation. Start with roughly 300 decisions as a budgeted pilot, split by task family or repository into calibration and untouched evaluation sets. Include candidate-order permutations, growing candidate sets, long evidence, stale observations, and adversarial result text. Set the final sample size from the error bound the rollout needs; do not present the pilot size as statistical certification.
3. **Live read-only tasks:** compare all arms on fresh isolated instances, initially 30 tasks across at least six families with three planner seeds. Keep task instances paired across arms and separate from calibration. Test plans generated from real goals, not only hand-authored plans. Treat this as a pilot for effect size and failure analysis; use its variance to size a later confirmatory study.
4. **Mutation qualification:** only after the read-only result is useful, add isolated disposable workspace mutations with external final-state checks and crash/cancellation injection. Introduce no automatic compensation or live resume in this stage.

The evaluator owns expected outcomes and verifies the world independently of both the planner's assertions and CLM's selections. Recorded-output replay cannot establish that the chosen actions complete a live task. Fixtures must include tasks where deterministic structure is sufficient, tasks where semantic selection is useful, and tasks the frozen plan cannot solve without replanning.

### Metrics and acceptance decisions

Measure candidate recall before ranking and conditional selection accuracy after the correct candidate is present. Report wrong continuations, wrong stops, abstention/escalation rate, false completion, task success, extra tool effects, full-model calls, all inference usage, total task cost, and end-to-end task latency. Plot error against autonomous coverage when choosing thresholds; a classifier that always abstains cannot pass by avoiding mistakes. Report ambiguous and out-of-distribution cases separately.

Latency measurements include observation construction, tokenization, cold candidate encoding, provider queueing, state encoding, network time, response validation, session flushes, and policy. Report p50/p95, cold and warm conditions, observation length, candidate count, question count, hardware, provider placement, and cache state. The [upstream engine](https://github.com/Contrastive-LM/CLM/blob/main/src/clm/engine.py) builds state-plus-question inputs separately and embeds fresh candidates; one HTTP request does not imply one encoding. Its reported speedups are not an acceptance target for this deployment.

The pilot proceeds to a larger evaluation only if mandatory runtime failures always stop in the tested cases, every selected binding is provenance-valid, CLM improves semantic decisions over arm C, and the task-level results show a plausible useful tradeoff relative to both A and B. Do not retain the earlier 90% binding target: per-step errors compound across a run. Do not claim a five-point success margin from 8–12 tasks.

Before a confirmatory run, freeze candidate extraction, thresholds, model/encoder identities, serializer, tasks, budgets, and decision criteria. A proposed promotion target is at least a 25% reduction in median total task latency versus A, a demonstrated advantage over B in latency or verified completion on semantic tasks, and a task-success difference whose paired 95% interval excludes a degradation greater than five percentage points. These are engineering decision targets, not measured results. Report the full interval and autonomous coverage; enlarge the sample or report inconclusive evidence when the data cannot support the decision.

Any false completion or unauthorized effect is a release blocker for the tested scenario. Zero observed wrong continuations still has uncertainty: under independent Bernoulli assumptions, the rough 95% upper bound is about `3/n` when no errors are observed. Correlated checkpoints require task-level or family-level resampling; do not count each step as an independent success to inflate certainty.

### Resources and spending

No GPU is needed for deterministic fixtures. Real CLM measurement requires an explicit deployment inventory and a warm matching encoder plus projection head; the small head alone is not the full serving requirement. Record expected runtime, model/API charges, GPU hourly rate, idle/prewarm cost, and a hard ceiling before any paid run. Request a spending cap only when paid execution is being scheduled. Head fine-tuning is deferred until frozen zero-shot evaluation reveals a specific correctable failure mode and a separate data/budget proposal is accepted.

## Implementation milestones

| Milestone | Deliverable | Exit evidence |
|---|---|---|
| M0: accepted intent | Promote the selected draft scope, update TASK progress, render agent intent, record provider/source pins | Spec lint and reviewed scope; no implementation claimed |
| M1: deterministic runner | Versioned plan parser, finite references/assertions, sequential dispatch, hard stops, budgets, recorder, deterministic judgment provider | Focused tests, assembled replay, cancellation and failure ordering |
| M2: CLM adapter | Wire validation, exact observation budgeting, provider identity, token accounting, semantic descriptions, score acceptance | Local protocol fixtures and separately reported live-provider smoke |
| M3: Dike evidence | Paired decision replay and live read-only comparison against A/B/C | Reproducible artifacts, cost/latency breakdown, confidence intervals, error cases |
| M4: Operations mode | Logged mode selection, sole-call enforcement, plan authoring guidance, replayable timeline, user stop | Real profile flow, SDK snapshots, browser evidence and recorded GUI demonstration |
| M5: bounded mutations | Approved tools in disposable workspaces, independent postconditions, unknown-outcome handling | World-state tests and crash/cancellation coverage before broader use |

M1 and M2 are the scope of the initial implementation task. M3 is a separate execution/spending decision; M4 and M5 receive their own accepted TASKs after the evidence gate. Each implementation PR updates the owning README, JSDoc, applicable catalogs, and this decision record. There is no estimated performance result or implied installation in the milestones.

### File and integration ownership

The experimental operation package owns proposed modules for plan parsing/resolution, observations, action candidates, assertions, the runner, judgment-service types, recording, and the `run_operation` consumer. The CLM provider owns HTTP transport, wire parsing, deployment compatibility, token accounting, and model identity. An evaluator under the repository's existing benchmark/test conventions owns fixtures, paired runs, independent labels, and reports. Keep tests near their implementation and retain only the externally necessary package exports.

The core tool registry may need a narrow public way to inspect the current canonical output schema if its existing view is insufficient; verify that need before adding an API. Do not add another dispatcher or scheduler. The session catalog and projections must learn operation events, and the TypeScript and Python SDK expected outputs must retain those events coherently. Initial generic presentation requires no new client package; a later timeline uses the existing conversation-node extension mechanism.

## Validation plan

Follow [testing policy](../../../../docs/testing.md) and select outgoing checks through [pre-push guidance](../../../skills/dsh-pre-push-checks/SKILL.md). A successful deterministic mock proves the protocol, not CLM quality or deployment latency.

| Surface | Required verification |
|---|---|
| Plan admission | Invalid references, unknown schemas, hidden tools, unsupported expressions, duplicate IDs, limits, and recursive/background tool rejection |
| Resolution and candidates | Missing versus null, exact types, source spans, correlated record bindings, candidate absence/overflow, argument validation, no dynamic shell interpolation |
| Execution ordering | Hard failures cause zero judgments; judgments cannot dispatch unknown candidates; only the next step runs; completion requires declared checks |
| Lifecycle | Abort before dispatch, during flush, during tool execution, during inference, late responses, plugin disposal, no subsequent effects, and quiescence |
| Recording | Exact request reconstruction, canonical-versus-rendered output difference, write failures before effects, invalid event sequences, interrupted tails, model-free replay |
| Provider | Finite complete distributions, candidate IDs, token overflow, truncation rejection, deadline, connection failure, identity/calibration mismatch, and cached versus fresh inputs |
| Policy | Concrete resolved arguments pass normal scoped discovery, approvals, sandbox and credentials; selected data cannot expand tool access |
| Product composition | Launch through a supported `dsh` profile with the real tool pipeline; record a keyless session and both SDK expected-output projections |
| External behavior | Verify final files or service state independently; live-provider smoke and Dike metrics remain distinct evidence |
| Later UI | Locale ownership, live and replayed statuses, sole-call enforcement, stop behavior, real server/model demonstration GIF |

Invariant checks should compare independently produced facts: dispatch/result pairing, decision-to-request identity, selected arguments matching recorded candidates, and absence of dispatch after terminal state. Avoid invariants that merely repeat a schema parser or assert fixed plugin metadata. Use isolated test resources and controlled synchronization for lifecycle tests; add provider race and crash tests through the repository's existing test launch mechanisms.

## Alternatives considered

**Existing PTC plus an optional judge tool.** This is the essential baseline and may be sufficient for some users. A model-written program can omit a checkpoint or ignore a judgment, so it does not enforce the proposed operation protocol. The sequential runner is justified only when enforced checkpoints and recorded bindings add measurable value.

**A general workflow DAG with compensation and automatic resume.** This adds dependency scheduling, side-effect recovery, and a persistent interpreter before the selection mechanism is validated. The initial ordered list can test the stated hypothesis; generalization waits for demonstrated workloads.

**CLM as a generator or parser of arbitrary stdout.** The released model ranks candidates. General extraction requires another mechanism with its own provenance, validation, latency, and cost. Return to the planner when bounded extraction fails.

**Independent choices for continuation, tool, and each argument.** Independently plausible answers can form an invalid operation. The initial design ranks complete next-action candidates derived from one coherent record; additional dependent questions must be explicit and measured if introduced later.

**Using CLM as the permission reviewer.** Task relevance and permission are different decisions. The existing policy system owns permission on resolved calls; sharing that authority with the continuation model would couple unrelated failure modes.

**Adopting JevHarness as the runtime.** [JevHarness](https://github.com/TianyuCodings/JevHarness) supplies the useful authoring/runtime separation and task-owned action model. Its programmable pipeline, evaluator, and deployment requirements do not establish integration with DSH's scoped tools, log, and approvals. Reuse the architectural idea and compare providers through the narrow judgment interface before adopting a second execution engine.

## Acceptance criteria

- The accepted first implementation runs short plans through existing DSH tools and records every model-visible judgment input without changing the agent loop.
- A complete next action and all selected values can be reconstructed from immutable observed records; no response can introduce a new tool or value.
- Known runtime failures stop deterministically, ambiguous observations return to the planner, and completion includes declared verification evidence.
- Cancellation, provider failures, and persistence failures stop subsequent dispatch; interrupted runs remain interrupted and replay causes no external effects.
- The initial tool remains opt-in, uses existing permissions, and is tested through a supported profile plus keyless Session and SDK projections.
- Dike reports candidate extraction, judgment quality, autonomy, task success, latency, and total cost separately, including PTC and deterministic-plan controls.
- Wider mode/UI/mutation work begins only when its task is accepted and the experiment supplies the intended evidence.

## Risks

The main research risk is that output extraction dominates difficulty: structured outputs may need little semantic help, while messy outputs may not provide recoverable candidates. CLM can be confidently wrong when every candidate is poor; explicit abstention and calibration limit exposure but do not prove correctness. The first plan language may require frequent replanning on tasks with discovery-dependent structure. Long observations and dynamic candidates may eliminate latency gains, especially with remote inference and durable checkpoints. The paired experiment determines whether the added interpreter earns its maintenance cost.

Operational risks include provider or tool changes during a run, stale evidence, output-driven argument abuse, and external effects with unknown outcomes. The proposal addresses these with current-policy dispatch, fixed tool names, source-bound selections, recorded identities, and explicit stops. It does not claim general semantic correctness, immunity to untrusted text, or exactly-once effects.

### Related decision audit

The scoped audit found no existing active CLM/Operations proposal to supersede. The PTC foundation, typed-return and canonical-output notes remain authoritative for the mechanisms reused here. The dynamic-workflow and checkpoint-policy decisions also remain active because their independent execution and durability rules still apply. This proposal changes none of those shipped decisions and archives no note.
