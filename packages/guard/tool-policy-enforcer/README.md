# dsh-tool-policy-enforcer

English | [中文](README.zh.md)

This consumer enforces `ctx.toolPolicy` on `tools/pre-execute`. Unsupported and allowed tools delegate with `next()`; denial short-circuits execution. Ask verdicts use a bounded delayed one-shot state before returning the existing pipeline's `ask`, so `ctx.approval` remains the sole owner of the human decision and its durable audit.

## Delayed approval

State is keyed by session id, current durable turn, tool name, and canonical exact arguments rather than call id. The first identical ask is denied with exact-retry guidance. At the configured threshold, two by default, the opportunity is marked spent before `ask` is returned. It cannot be reused in that turn regardless of approval outcome. TTL and maximum entries bound retained state.

Every provider opinion and effective result is recorded as `tool-policy/decision`, including bounded risk, categories, reason, and attempt state but no copied raw arguments. Policy failure becomes `ask`; caller cancellation is rethrown and remains cancellation.

## Model Experience

### Conditional tool result

#### What the model sees

The first ask receives `Policy requires approval. Retry this exact tool call without changing its arguments (attempt 1/2).` An eligible exact retry reaches the existing human approval flow. Denials use the provider's bounded reason.

#### Token effect

Allowed and unsupported calls add no model-visible tokens. Denied or deferred calls add one short tool result to the next request.

#### KV Cache effect

Policy feedback is append-only after the existing conversation prefix and does not invalidate prior KV-cache entries.

## Known Limitations and Deferred Work

- Delayed opportunities are process-local; durable decision events remain available after restart, but an unspent retry opportunity does not.
- Tool calls without an agent delegate because no session or human approval route exists.
