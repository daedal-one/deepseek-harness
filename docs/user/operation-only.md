---
description: "Use an experimental coding profile whose planner delegates every tool action through run_operation."
kind: "guide"
---

# Operation-only planning

## Summary

An operation-only profile lets the main model analyze and plan while `run_operation` executes short sequences and asks a local decision model whether to continue, complete, stop, or return for replanning. The planner has one callable tool. Reads, searches, small edits, and shell commands use the Session's existing permissions and execution environment. This profile is experimental and requires an independently configured decision service.

## Table of Contents

- [Choose the profile](#choose-the-profile)
- [Work with operations](#work-with-operations)
- [Configure a deployment](#configure-a-deployment)

## Choose the profile

Start a new Session and select the operation-only copy of your coding profile in the profile picker. Choose the main planning model as usual. Existing conversations keep their original composition; a profile cannot be switched after a Session produces messages or tool calls. See [agent presets](../../packages/preset/agent-presets/README.md#switching-a-sessions-preset).

The local decision engine runs beside the existing DSH server. It does not require another Web server, browser address, or workspace. Its loopback HTTP listener is for the DSH provider, and its process has independent supervision and resource limits.

## Work with operations

Ask for work normally. The planner submits a goal and a short sequence of exact actions with ordinary arguments. The harness supplies step identities, result checks, observations, and completion evidence. The runner performs those actions sequentially, records their results, and returns bounded declared observations to the planner. A read or search can gather evidence for the next planning step. Small edits use literal content; shell arguments cannot be built from previous tool output inside the same operation.

For a simple request, the planner is guided to start with the smallest useful plan and answer once it has the requested facts. Independent status checks can share one foreground shell step. The ordinary call needs only `plan: {goal, steps: [{tool, arguments}]}`. A compatible admitted bash action receives a tested repository-status example. The planner can select complete evidence with an optional `observe` pointer list; detailed programs are available for typed references and custom assertions. A replanning outcome can retain useful completed read evidence, so subsequent plans gather only missing facts. Necessary evidence remains complete and subject to the configured limits.

Permissions still apply to each underlying action. Read/search and small edits run autonomously when your Session policy permits them. A shell action that needs approval still asks for it. A failed process, interrupted action, clipped observation, missing evidence, or uncertain decision stops progression. The planner can inspect the outcome and propose another plan; interrupted mutations are never automatically repeated.

The decision model starts only after the planner submits an actual `run_operation` call and an action produces evidence. Reasoning by the main model does not start it. A main-model response containing only reasoning or whitespace is an `EMPTY_RESPONSE` failure handled by the configured request retry policy. If it persists, choose another main model and continue the same Session; the profile and execution environment remain the same.

## Configure a deployment

The private [Decision Engine repository](https://github.com/daedal-one/decision-engine) owns Python inference, immutable model provisioning, and independent supervision. The [Kev adapter](../../packages/experimental/operation-kev/README.md) owns the required DSH configuration and credential reference. Prepare these before creating the profile.

Copy your existing coding preset under a new id, retaining its execution providers, permissions, tools, and skills. Append the [operation composition fragment](../../apps/cli/config/examples/operation-only.agent.yml), resolving its relative module names to the installed private package paths. Supply `DSH_OPERATION_DECISION_CONFIG` as the complete Kev provider configuration in the server's private launch environment, and provision its bearer value through the configured credentials provider. Neither value belongs in the repository. The fragment isolates both operation services and exposes only `run_operation` for this preset; omit any other presentation selector from the copy.

The example explicitly disables the calibration requirement for experimental evaluation. It keeps the runner's confidence thresholds and independent process/result checks. Service readiness and one successful inference are not model calibration or evidence that its decisions are reliable across coding tasks. A qualified deployment supplies its calibration declaration and enables `requireCalibration`. The [operation package reference](../../packages/experimental/operation/README.md) owns plan expressions, limits, and canonical result checks.
