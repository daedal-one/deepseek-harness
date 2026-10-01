# Agent Note: Fail-closed operation admission and evidence

Status: implemented

## Problem

A finite operation sequence can still start background work when admission relies on tool names. Tool cancellation also arrives through the ordinary registry as a normalized error, while replay needs to retain both the terminal cause and the uncertainty of interrupted work. CLM token budgeting can diverge from inference when it renders draft objects in a different order from the serialized request.

## Decision

The experimental runner requires a trusted policy registered for the exact visible `ToolDefinition` instance. The composing deployment reviews read-only behavior and supplies argument checks and a canonical result inspector; no production tool is eligible by default. Each dispatch rechecks definition and policy identity and still uses the caller's ordinary registry pipeline. A captured dispatch constraint repeats those checks immediately before the tool body, after asynchronous policy and wrappers, exposes the effective body signal to its trusted owner, and prevents wrappers from invoking that body twice. The foreground-process policy forbids output-derived arguments and interprets structured timeout, abort, signal, sandbox, exit-code, and truncation facts independently of success prose.

Schema preflight rejects a reference only when the admitted tool schemas establish its impossibility. Open schemas, optional properties, and overlapping alternatives remain subject to concrete resolution; treating unknown structure as absence would reject valid plans without improving execution safety.

Admission records caller correlation and effective configuration separately from opaque process-local execution tokens. Schema, argument, canonical-result, and judgment-evidence digests bind recorded values to their sources. Fingerprints diagnose internal inconsistency rather than authenticating the remote deployment, and optional metadata preserves old operation records without fabricating missing evidence.

The runner records settled tool and judgment outcomes before terminal handling. Caller cancellation, owned deadlines, and ordinary failures retain separate causes. Settled execution records independently retain body-entry and interruption facts from both the operation and the body's effective fused signal, so ordinary timeout-policy or a tool-owned error cannot erase an interrupted body's unknown external outcome; an intent-only crash cannot establish that dispatch occurred. Judgment responses survive an output-budget stop. Mandatory checkpoint counts and runner-owned choices count toward admission and candidate limits. Replay exposes admission, outcomes, failures, and exact selected transitions without invoking tools or inference. Each noninitial step intent must match its accepted continuation and canonical source record; completed outcomes require the final accepted completion checkpoint and recorded verification. Contradictory transitions and post-terminal records reject.

The CLM adapter renders the canonical wire's object order and JSON numeric spellings before counting tokens. Each independently encoded text must fit the explicitly configured, reviewed server encoder ceiling. Provider configuration is snapshotted and fingerprinted without credential values, so caller-side mutation cannot change the endpoint, encoder ceiling, or temperature behind its recorded identity. Credential references distinguish authenticated routes, while the serialization identity must match the implemented protocol recipe. Provider teardown owns tokenizer preparation as well as HTTP requests. Redirects are refused rather than silently changing endpoints.

## Alternatives considered

**Expand the forbidden-name list.** Rejected as the admission mechanism because aliases and provider-specific delegation tools can escape it. Exact-instance eligibility is deployment-owned and defaults to denial.

**Treat a normalized cancellation result as an ordinary tool failure.** Rejected because cancellation must stop the operation distinctly and a started aborted body can have an unknown external outcome.

**Trust aggregate input usage or silently truncate.** Rejected because upstream usage counts cache misses and truncation changes the evidence being judged. Local per-encoder counts and explicit ceilings preserve complete inputs.

## Consequences

Tool replacement or policy withdrawal stops an admitted run. Opt-in deployments must register reviewed policies and the exact tokenizer, and record their reviewed server ceiling. The feature remains bounded to M1/M2; none of these registrations authorize production mutations, retries, delegation, restart continuation, or paid experiments.

Deterministic tests establish pipeline, lifecycle, wire, and replay behavior only. No live CLM smoke, deployed-tokenizer equivalence, calibration quality, or task-quality result is established. The [accepted task](../../../../.specs/tasks/clm-operations.spec.md) records the separate qualification limits.
