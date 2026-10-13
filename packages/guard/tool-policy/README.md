---
description: "Combine tool-policy providers through one decision service."
kind: "package-reference"
---

# dsh-tool-policy

## Summary

Combine tool-policy providers through one decision service. Consumers submit a tool call and its Agent context, and providers return an allow, ask, or deny decision with attributable evidence. This package defines the vocabulary and registry; an enforcer must apply the result.

## Table of Contents

- [Use this package](#use-this-package)
- [Service](#service)
- [Durable events](#durable-events)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

`ctx.toolPolicy` is the provider-neutral authorization service. Providers register under stable ids; deployments configure an ordered set or omit it to evaluate every registered provider. Duplicate ids and missing configured providers fail loud.

No shipped profile mounts this service. The opt-in [`@deepseek-ai/dsh-policy`](../../bundle/policy/README.md) bundle is its shipped owner: that layer mounts this row and declares the enforcement and provider rows disabled until a deployment configures them.

## Service

`prewarm(request)` offers the session and cancellation to each selected provider's optional preparation hook. `evaluate(request)` supplies immutable tool identity, JSON arguments, the calling agent, and cancellation. Every selected provider runs in parallel. Unsupported providers return `undefined`; one supported verdict passes through, while overlapping verdicts combine conservatively as `deny` over `ask` over `allow`, with maximum risk and merged bounded categories and opinions. Providers own tool-specific interpretation and must preserve caller cancellation.

Registrations are effect-owned by provider plugins. Unloading a provider removes it without retaining a stale implementation.

## Durable events

`tool-policy/classifier-request` records an auxiliary route, purpose, fixed prompt, reconstruction selectors, and bounds before model dispatch. `tool-policy/intent-context` records bounded validated context that a later classifier receives. Native tool arguments remain in `tool/call`; `tool-policy/nested-call` records the exact nested input and its native root, immediate parent, and optional parent transport without adding a conversation tool call. `tool-policy/decision` records provider and effective outcomes for either kind of call, and `tool-policy/nested-result` records nested settlement. These audit records do not enter model history.

The invariant companion requires each nested root and parent to identify one earlier, unsettled call in the current open turn; overlapping native or nested owners of a referenced id are ambiguous and rejected. Call ids may recur after settlement, including across steps of one turn: native results pair by turn, step, id, and one exact cited input sequence; missing legacy references pair only when the full turn/step/id tuple identifies one input occurrence; nested results settle the latest outstanding same-turn nested input in event order, never an earlier result for a reused id. Nested input ids cannot overlap another unsettled call; transport labels must match the parent name. Effect requests and decisions require one unsettled owner; effective decisions require a provider decision after that owner's input.

## Model Experience

### Conditional tool result

#### What the model sees

The service adds no prompt or tool schema. Consumers decide how an `evaluate()` verdict changes execution feedback.

#### Token effect

Classifier calls consume their configured auxiliary-model budget. Durable audit events do not enter model history.

#### KV Cache effect

The service does not alter the main request, so it does not invalidate its KV-cache prefix.

## Known Limitations and Deferred Work

- Provider availability is checked at evaluation time because plugins may reload.

### Dev Note

None.
