# dsh-tool-policy-enforcer

This consumer enforces `ctx.toolPolicy` on `tools/pre-execute`. Unsupported and allowed tools delegate with `next()`; denial short-circuits execution. An `ask` verdict first returns its bounded reason to the acting agent, then enters the existing approval pipeline when the configured consecutive-identical threshold is reached, so `ctx.approval` remains the sole owner of the human decision and its durable audit.

`enforceWhen` optionally restricts evaluation to a conjunction of effective `sandbox/mode` and `approval/policy` values. The enforcer folds those values from the calling session's durable events before consulting any provider. An omitted condition preserves unconditional enforcement, and a missing configured value keeps enforcement active because the session cannot establish the configured bypass.

When an enforced session accepts a direct user message, the enforcer calls `ctx.toolPolicy.prewarm()` without delaying event publication. Permission changes also offer a prewarm opportunity for the latest direct message. Provider preparation is optional and fail-closed evaluation remains authoritative; calls outside `enforceWhen` do not start preparation.

## Approval threshold

`approvalThreshold` is the number of consecutive calls with the same tool and canonical arguments required before an `ask` enters human approval; it defaults to `3` and rejects non-integers or values below `2`. Calls below the threshold return a denied tool result containing the provider reason, attempt number, and threshold. The acting agent can change approach or repeat the exact call without interrupting the user on the first false positive.

The enforcer derives the chain from the current turn's durable `tool/call`, effective `tool-policy/decision`, and `tool/result` events instead of process-local state. Deep key sorting makes argument-object order irrelevant. An intervening call, turn boundary, unsupported or non-ask verdict, or successful approved execution breaks the chain. A rejected approval remains a denial in the same chain, so the next identical call stays approval-eligible rather than becoming permanently blocked.

Every provider opinion and effective result is recorded as `tool-policy/decision`, including bounded risk, categories, and the provider or deferred reason but no copied raw arguments. Policy failure becomes `ask`; caller cancellation is rethrown and remains cancellation. Deterministic provider denials never enter approval.

## Model Experience

### Conditional tool result

#### What the model sees

The first two identical `ask` verdicts under the default threshold return `Error: Automatic policy review denied this call without asking the user (attempt <n>/3): <reason>. Change approach or retry this exact tool call; attempt 3 asks the user.` The third opens the existing human approval flow. A grant executes that exact call once; rejection, cancellation, or an unavailable answerer returns the approval service's bounded tool error. Deterministic denials use the provider's bounded reason without prompting.

#### Token effect

Calls outside `enforceWhen`, allowed calls, and unsupported calls add no model-visible tokens. Denied or deferred calls add one bounded tool result to the next request.

#### KV Cache effect

Policy feedback is append-only after the existing conversation prefix and does not invalidate prior KV-cache entries.

## Known Limitations and Deferred Work

- Tool calls without an agent delegate because no session or human approval route exists.
