---
id: REQ:tools/operations
type: requirement
status: accepted
level: MUST
summary: Execute bounded sequential operation plans through existing tools with deterministic checks and recorded CLM continuation choices.
owners: [carlo]
---

# Operation plans with semantic checkpoints

This requirement defines the first execution slice proposed in the [implementation proposal](../../.agents/notes/proposed/feature/2026-09-27-clm-operations-mode.md). It does not claim implementation or authorize inference spending.

:::{requirement id="operations" level="MUST"}
- {#c-composition} Operation execution MUST be opt-in and composed through existing plugin and tool extension points. The first runner MUST execute a finite ordered sequence without automatic retries, background work, nested operation runs, or live restart continuation.
- {#c-plan} The runner MUST validate and freeze a versioned JSON plan, fixed tool names, backward-only typed references, assertions, completion checks, resolved deployment limits, and tool schema identities before execution. References MUST preserve missing-versus-null distinctions and MUST be validated again against concrete resolved values.
- {#c-planner} The model-facing plan schema MUST describe required fields and tagged expression and assertion alternatives. Scoped planner guidance MUST favor the smallest useful evidence-gathering plan and answering once the requested facts are sufficient. A displayed action example MUST agree with the admitted action schema and have executable validation evidence. Recursive expressions and semantic constraints MUST retain strict parser validation; guidance MUST NOT weaken permissions, mandatory checks, evidence completeness, or inference limits.
- {#c-policy} Every step MUST execute through the calling agent's ordinary tool registry with its scope, discovery, permissions, credentials, sandbox, and cancellation. Plan metadata and model judgments MUST NOT confer authority. Concrete resolved arguments MUST pass current policy before dispatch.
- {#c-entrypoint} An operation-only profile MUST expose `run_operation` as its sole model-callable tool and deny direct underlying calls in the executor before approval or tool effects. The planner MUST receive the available action schemas and operation language. Runner-owned nested calls MUST retain normal permission policy, caller scope and execution placement. Read/search and small edits MAY execute autonomously when that policy allows them; foreground shell actions MUST retain independent process-outcome checks. A local decision service MAY share the existing server host under independent supervision without creating another DSH Web server.
- {#c-hard-stops} Cancellation, denied or failed execution, invalid output, mandatory assertion failure, persistence failure, and exhausted limits MUST prevent subsequent dispatch. Required failures MUST stop before semantic inference; process timeout, signal, and sandbox facts MUST be interpreted independently of exit code.
- {#c-evidence} Observations and candidates MUST derive from post-policy canonical values with source provenance. Missing, ambiguous, oversized, or incomplete necessary evidence MUST return control without invented values or silent truncation. Output-derived values MUST NOT be interpolated into shell command strings in the first runner.
- {#c-selection} Each successful step MUST reach a semantic checkpoint before continuation or completion. A continuation candidate MUST bind the next fixed tool and its complete resolved arguments coherently. A judgment MUST select only supplied candidate identities or runner-owned stop/replan choices; acceptance MUST enforce validated response coverage and the configured calibration rule.
- {#c-provider} The judgment provider MUST expose bounded candidate ranking without generation or tool authority. It MUST propagate cancellation, validate bounded wire responses, identify its model and encoding recipe, and reject input truncation or missing required calibration outside shadow evaluation. Provider failure MUST NOT silently retry or switch models.
- {#c-durability} The runner MUST record its plan, canonical evidence, exact judgment inputs, candidate mapping, responses, selected arguments, limits, identities, and terminal outcomes. It MUST flush the judgment request before inference and the selected transition with step intent before the next tool dispatch. A recording or flush failure MUST stop later work.
- {#c-lifecycle} A run MUST own and drain its tool and inference requests. Late results MUST NOT revive a terminal run. Interrupted dispatches MUST retain unknown-outcome semantics and MUST NOT be retried automatically.
- {#c-replay} Replay MUST reconstruct decisions solely from recorded facts without executing tools or models. Fresh judgment evaluation and new planner runs MUST have separate identities and MUST preserve original records.
- {#c-completion} Completed execution MUST require all declared verification checks and the final semantic checkpoint. Stopped, needs-replan, failed, cancelled, and interrupted outcomes MUST remain distinguishable; declared checks MUST NOT be presented as independent proof of arbitrary goal satisfaction.
- {#c-evaluation} Evaluation MUST compare ordinary agents, existing PTC, deterministic plans, and identical plans with CLM judgments. It MUST separate candidate recall, conditional ranking accuracy, autonomous coverage, incorrect continuation, final-world success, latency, and total cost, using independent labels and separate calibration/evaluation cases.
- {#c-verification} Implementation MUST include focused protocol and lifecycle tests, a supported-profile composition test, keyless Session replay, and TypeScript/Python SDK projections. Live-provider and task-quality evidence MUST be reported separately from deterministic fixtures. New session records MUST follow released Session-format rules without rewriting committed generations.
:::
