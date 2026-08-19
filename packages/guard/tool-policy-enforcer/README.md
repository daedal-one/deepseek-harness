# dsh-tool-policy-enforcer

English | [中文](README.zh.md)

This consumer enforces `ctx.toolPolicy` on `tools/pre-execute`. Unsupported and allowed tools delegate with `next()`; denial short-circuits execution. An `ask` verdict immediately enters the existing approval pipeline, so `ctx.approval` remains the sole owner of the human decision and its durable audit.

`enforceWhen` optionally restricts evaluation to a conjunction of effective `sandbox/mode` and `approval/policy` values. The enforcer folds those values from the calling session's durable events before consulting any provider. An omitted condition preserves unconditional enforcement, and a missing configured value keeps enforcement active because the session cannot establish the configured bypass.

When an enforced session accepts a direct user message, the enforcer calls `ctx.toolPolicy.prewarm()` without delaying event publication. Permission changes also offer a prewarm opportunity for the latest direct message. Provider preparation is optional and fail-closed evaluation remains authoritative; calls outside `enforceWhen` do not start preparation.

## Direct approval

The enforcer is stateless and has no retry threshold. Every provider opinion and effective result is recorded as `tool-policy/decision`, including bounded risk, categories, and reason but no copied raw arguments. Policy failure becomes `ask`; caller cancellation is rethrown and remains cancellation. Deterministic provider denials never enter approval.

## Model Experience

### Conditional tool result

#### What the model sees

The first `ask` opens the existing human approval flow. A grant executes that exact call once; rejection, cancellation, or an unavailable answerer returns the approval service's bounded tool error. Denials use the provider's bounded reason without prompting.

#### Token effect

Calls outside `enforceWhen`, allowed calls, and unsupported calls add no model-visible tokens. Denied or deferred calls add one short tool result to the next request.

#### KV Cache effect

Policy feedback is append-only after the existing conversation prefix and does not invalidate prior KV-cache entries.

## Known Limitations and Deferred Work

- Tool calls without an agent delegate because no session or human approval route exists.
