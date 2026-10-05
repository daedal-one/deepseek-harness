# Agent Note: Operation-only planning and an independent inference engine

Status: implemented

## Problem

A planner that sees ordinary tool schemas beside an operation entrypoint can bypass delegated execution. A status-only operation result also prevents the planner from inspecting the evidence needed for its next plan. Keeping an inference service inside the harness source ties model serving and its large environment to the harness release lifecycle.

## Decision

The [tool registry](../../../../packages/core/tools/README.md) provides `operation` presentation: only the admitted `run_operation` definition reaches the model, and direct underlying calls fail before policy or body execution. Trusted nested dispatch retains the ordinary Session scope, discovery, approvals, credentials, execution providers, and cancellation. Presentation remains scoped, so native conversations coexist in the same process.

The [operation agent plugin](../../../../packages/experimental/operation/README.md) binds explicit operator-selected tools to their exact definition instances. A coding composition can choose its whole current inventory; names alone do not carry eligibility into replacement definitions. Foreground process checks classify canonical exit, signal, cancellation, timeout, and stream completeness. Literal small edits have an explicit combined-byte ceiling. Other composed actions retain ordinary schema and permission authority; this broad composition does not independently certify arbitrary tool semantics. Pending work cannot certify completion, and declared assertions remain necessary.

The planner receives complete declared observations only when `returnObservations` is enabled. They retain the existing observation byte bound and are logged in the ordinary outer tool result. Plan expressions cannot derive process or mutation arguments from previous results. The initial standalone read-only composition remains separately available; its root mapping and source completeness rationale stay in the [local serving note](2026-10-01-local-cpu-decision-serving.md).

The private [Decision Engine repository](https://github.com/daedal-one/decision-engine) owns the extracted Python source history, provisioning, and independently supervised CPU scorer. DSH owns the adapter and wire protocol. A decision listener does not create a second DSH Web server or change existing Session execution environments. Private manifests, credentials, host paths, and resource assignments remain operator state.

## Alternatives considered

**Hide schemas without executor enforcement.** A model can still name an omitted tool. Executor admission supplies the denial guarantee before an effect or approval prompt.

**Give the planner a second direct read or edit path.** Two interaction paths weaken the requested delegation rule. Read/search and small edits use the same operation entrypoint and ordinary permissions.

**Share an operation service globally or start another Web server.** Either choice gives the new composition the wrong scope. Preset-local service realms preserve existing conversations; the independent inference process owns only scoring.

## Consequences

The profile is opt-in and experimental. Explicitly disabling calibration permits evaluation without inventing a qualification identifier; it does not relax confidence thresholds or permit retries. Serving readiness, bounded inference measurements, and synthetic protocol replay do not establish model quality. The [CLM adapter note](2026-09-28-clm-system-one-operation-adapter.md) retains independent wire and durable-evidence rationale.
