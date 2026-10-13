---
description: "Enforce automatic tool policy and request explicit user approval for a denied action."
kind: "package-reference"
---

# dsh-tool-policy-enforcer

## Summary

Apply automatic policy before a tool executes. Uncertain calls return a reason so the agent can choose another approach or request explicit user approval. Approval permits one exact retry; repeating a denied call never opens a prompt. Prohibited calls remain blocked, including after an approval.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Mount this plugin with `tools`, `toolPolicy`, and an approval service with an answerer. Unsupported and allowed tools continue through the execution pipeline; deterministic denials stop execution. An uncertain `ask` returns its reason and the denied call id. The agent can call `request_tool_approval` with that id and a justification, then retry the exact tool and arguments once after approval succeeds.

No shipped profile mounts this consumer. The opt-in [`@deepseek-ai/dsh-policy`](../../bundle/policy/README.md) bundle declares its row disabled, because an active enforcer with no registered provider receives an unavailable policy and defers every agent tool call.

`enforceWhen` optionally restricts evaluation to a conjunction of effective `sandbox/mode` and `approval/policy` values. An omitted condition preserves unconditional enforcement; a missing configured value keeps enforcement active. The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-policy-enforcer) owns the accepted fields.

An approval request must identify a completed automatic policy denial in the same Session and open turn. The user sees the exact tool arguments, automatic review reason, and model justification. A grant belongs to the first subsequent matching call; changing arguments cannot use it. A user rejection prevents further approval requests for that action in the turn. Missing or disabled approval, cancellation, and unavailable answerers do not grant permission.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The enforcer consumes `ctx.toolPolicy` on `tools/pre-execute` and records provider and effective decisions. Policy failures become uncertain denials; caller cancellation remains cancellation. `request_tool_approval` reaches the approval service directly after validating the referenced denial, so it cannot recursively require policy approval itself. Other execution guards remain active.

The [approval helper](src/approval.ts) reconstructs grants from recorded native or PTC calls, approval audit pairs, and successful approval-tool results. Canonical JSON comparison ignores object-key order. The first subsequent matching recorded call consumes a grant even if that call is cancelled or fails, so concurrent matching calls cannot share it. Turn boundaries discard prior grants. A retry still evaluates current policy, and a deterministic denial always wins. No process-local grant or retry counter exists.

Direct user messages and permission changes offer `ctx.toolPolicy.prewarm()` without delaying publication. Calls outside `enforceWhen` do not start preparation. No invariant companion is published because the tool-policy and approval services own the durable audit relationships; grant matching derives from those records without maintaining independent state.

</details>

## Model Experience

### Tool schemas

#### What the model sees

[`request_tool_approval`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-policy-enforcer) takes a denied `call_id` and `justification`. Its description states that it requests permission without executing the action, permits one exact retry in the same turn after success, and cannot approve deterministic denials. Its successful result instructs the model to retry once. A rejected or unavailable request returns an error.

#### Token effect

One tool schema is added while the plugin is mounted.

#### KV Cache effect

The schema remains stable across calls and approval outcomes. Mounting or removing the plugin changes the tool catalog.

### Conditional tool result

#### What the model sees

An uncertain call returns `Error: Automatic policy review denied this call without asking the user: <reason>. Do not repeat this call to trigger approval. If the action is still necessary, call request_tool_approval with call_id "<id>" and a justification, then retry this exact call only if approval succeeds.` Deterministic denials return the provider reason without an approval hint.

#### Token effect

Denied calls add one tool result. Explicit approval adds one request/result exchange before the authorized retry. Allowed and unsupported calls add no policy feedback.

#### KV Cache effect

Policy feedback appends after the conversation prefix and does not invalidate earlier entries.

## Known Limitations and Deferred Work

- Calls without an agent delegate because no Session or user approval route exists.
- Approval expires at the end of the current turn and requires a completed, recorded denial and approval result.

### Dev Note

None.
