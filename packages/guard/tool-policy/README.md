# dsh-tool-policy

English | [中文](README.zh.md)

`ctx.toolPolicy` is the provider-neutral authorization service. Providers register under stable ids; deployments configure an ordered set or omit it to evaluate every registered provider. Duplicate ids and missing configured providers fail loud.

## Service

`evaluate(request)` supplies immutable tool identity, JSON arguments, the calling agent, and cancellation. Every selected provider runs in parallel. Unsupported providers return `undefined`; one supported verdict passes through, while overlapping verdicts combine conservatively as `deny` over `ask` over `allow`, with maximum risk and merged bounded categories and opinions. Providers own tool-specific interpretation and must preserve caller cancellation.

Registrations are effect-owned by provider plugins. Unloading a provider removes it without retaining a stale implementation.

## Durable events

`tool-policy/classifier-request` records an exact bounded auxiliary request before model dispatch. `tool-policy/decision` records provider and effective outcomes without copying raw arguments already present in `tool/call`. The invariant companion requires both events to follow the matching call in its open turn.

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
