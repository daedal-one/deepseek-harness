# Agent Note: Independent tool-policy evidence and direct approval

Status: implemented

## Problem

The shell policy sent the raw user request, acting-model description, command, and working directory to one effect classifier. A broad user request could therefore change how the same read-only command was classified: simple `cat`, `sed`, and `awk` diagnostics inherited repository-wide mutation or deletion risk from the surrounding task. The classifier then treated its own interpretation as the policy decision, so free-form categories and risk thresholds carried authorization semantics that host code could not validate.

The deterministic read set was too small to absorb common inspection pipelines. A false-positive `ask` also forced the acting model to repeat the exact call before the existing approval service was consulted. That repeat added a model turn without adding independent evidence or a human decision.

## Decision

`dsh-tool-policy-shell` remains an effect-scoped provider of the existing `ctx.toolPolicy` Service Definition. `dsh-tool-policy-enforcer` remains its ordinary `tools/pre-execute` Consumer. The intent and effect reviewers are private implementation capabilities passed within the shell provider; they do not create a public service with one internal caller, and the agent loop remains unchanged.

Fixed security decisions and ordered deployment rules run first. A deliberately small parser then admits literal read-only pipelines and command lists whose stages write only to stdout and whose resolved file operands stay in the workspace or platform temporary directory. A workspace-resetting `cd`, literal status output, and stderr discard to `/dev/null` cover compound inspection calls without admitting general shell execution or redirection. Substitution, other redirection, write flags, unresolved operands, and symlink escapes leave this fast path. Commands outside the parser continue to model review; parser incompleteness never grants permission.

The enforcer offers preparation only for sessions matching `enforceWhen`. A direct user message starts intent-context preparation while the acting agent works. Concurrent callers share the exact in-flight request, but only validated context remains reusable for the same latest message; malformed or unavailable preparation fails closed for its current waiter and is discarded so a later evaluation can prepare again. The route receives bounded ordered direct-user messages, but no acting-model intent or command, and returns a short summary plus allowed and explicitly forbidden effects. This keeps follow-ups such as `Continue` connected to earlier direct instructions without copying the conversation into later requests.

An unmatched command makes one primary tool-time request with the validated short context, bounded acting-model intent, exact command, and working directory. It receives no raw user message and returns one compact line containing alignment and direct effects. The effect prompt resolves explicit command paths against the working directory and excludes ambient shell, executable, library, implicit tool-configuration, cache, descriptor, and `/dev/null` access. It reports an outside-workspace effect only when a command operand explicitly names or derives a path outside the working directory. Intent and primary may use the same provider/model route because their requests remain separate and their inputs serve different stages. The secondary effect route remains distinct from the primary, and runtime excludes any route matching the acting model. An intent route matching the acting model fails closed because self-review is not independent.

Auxiliary output uses compact exact-line protocols over a closed shell-effect list. The intent prompt assigns allowed effects, forbidden effects, and the summary to three numbered newline-separated lines and supplies the literal empty-effects prefix so the configured route keeps both effect fields distinct. Effect parsing accepts semicolon- or comma-separated compact fields and an exact closed JSON object. Strict validation rejects extra fields, unknown effects, conflicting allow and forbid sets, and output beyond deployment bounds. Deterministic host code derives risk and the verdict: baseline reads and local computation may pass, workspace mutation and ordinary filesystem reads outside the working directory require aligned and explicit matching intent, and network, credential, process-control, privilege, external-mutation, or destructive effects require approval. `host-read` is limited to non-file operating-system or hardware information so it cannot grant the more specific `outside-workspace-read` effect. Models provide evidence; they do not own the final policy rule.

Preparation has its own timeout outside tool execution. One decision deadline covers the primary effect request and any secondary fallback; fallback receives only the remaining time and cannot restart the wait. A secondary effect route runs only when the primary route returns no valid effect evidence and never overrides a validated sensitive effect. A superseded malformed or unavailable primary opinion remains in the audit but does not inflate risk from a validated secondary decision. Caller cancellation releases its waiter and cancels shared work when no waiter remains.

Classifier-request events store the route, purpose, fixed system prompt, reconstruction selectors, and input bounds before dispatch. A validated `tool-policy/intent-context` event is the short model-visible handoff. Raw user text remains in `user/message`; acting-model intent and raw tool arguments remain in `tool/call`. The invariant verifies the user-message-to-context-to-tool-call chain, current tool-time turn, matching call, and purpose/input selector agreement. This retains exact reconstructibility without keeping a second raw copy.

An effective `ask` immediately enters the existing approval service. The enforcer has no retry threshold or process-local opportunity state. A grant applies to the exact call once; deterministic denials never become approvable.

## Alternatives considered

**Send raw user messages directly to the command classifier.** Rejected because task-wide mutation language can contaminate classification of a read-only command and untrusted text gains a direct path to the action reviewer. A bounded independent context keeps authorization evidence attributable while preserving command-specific classification.

**Publish a separate intent-review Service Definition.** Rejected because only the shell policy provider consumes this interpretation. A private capability closure preserves the plugin boundary without adding an incomplete public seam or speculative provider ecosystem.

**Adopt Tree-sitter Bash for the read fast path.** Rejected for this bounded grammar. The Node bindings add native build and platform packaging work, while an AST still needs repository-owned semantic rules for options, redirection, resolved paths, and symlink escape. A fail-closed literal parser keeps the grant surface smaller and has direct invalid-case tests. A broader grammar can justify a maintained parser dependency later.

**Let reviewers return open-ended effects.** Rejected because synonyms and invented categories make host policy ambiguous and reproduce the original model-owned threshold problem. The closed list costs category maintenance but makes every accepted result executable by deterministic code.

**Retain the exact-call retry before approval.** Rejected because repeating identical arguments adds no evidence, creates model-visible friction on false positives, and duplicates the one-shot ownership already provided by `ctx.approval`.

## Consequences

Common literal inspection pipelines avoid tool-time auxiliary latency. Other commands normally make one small tool-time request after one validated context preparation per direct user message; a failed preparation may be retried by a later evaluation, and missing or invalid primary effect evidence can make a secondary request. The extra token cost buys independent evidence and is bounded by fixed prompts, closed line protocols, shared in-flight preparation, validated-context reuse, and secondary-on-demand dispatch.

The closed effect vocabulary may need deliberate extension as new shell capabilities appear. Unknown effects fail closed, so an omitted category causes approval rather than permission. The read parser likewise favors false negatives: unsupported flags or syntax use model evidence instead of expanding the deterministic grant surface by guesswork.

False-positive `ask` decisions now reach a person on the first call. This can surface more approval prompts when classifiers are uncertain, but it removes the mandatory retry turn and keeps the existing durable approval audit as the only human-decision mechanism.

Focused unit tests cover strict evidence parsing, host combination rules, compound read escape cases, policy-gated prewarming, failed-preparation recovery, context handoff, same-route review, fallback, the shared tool-time deadline, cancellation, and disposal. A real Loader composition covers the full provider-consumer lifecycle, and the keyless Daedal snapshot drives the assembled profile from malformed preparation through a recovered context and effect review. Self-skipping real-provider tests use terse continuation and status histories plus synthetic paths under the platform temporary directory to verify intent framing and distinguish workspace Git inspection from a named outside-workspace read and an approval-requiring network effect without disclosing repository content.
