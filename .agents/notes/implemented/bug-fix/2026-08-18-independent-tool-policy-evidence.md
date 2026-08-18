# Agent Note: Independent tool-policy evidence and direct approval

Status: implemented

English | [中文](2026-08-18-independent-tool-policy-evidence.zh.md)

## Problem

The shell policy sent the raw user request, acting-model description, command, and working directory to one effect classifier. A broad user request could therefore change how the same read-only command was classified: simple `cat`, `sed`, and `awk` diagnostics inherited repository-wide mutation or deletion risk from the surrounding task. The classifier then treated its own interpretation as the policy decision, so free-form categories and risk thresholds carried authorization semantics that host code could not validate.

The deterministic read set was too small to absorb common inspection pipelines. A false-positive `ask` also forced the acting model to repeat the exact call before the existing approval service was consulted. That repeat added a model turn without adding independent evidence or a human decision.

## Decision

`dsh-tool-policy-shell` remains an effect-scoped provider of the existing `ctx.toolPolicy` Service Definition. `dsh-tool-policy-enforcer` remains its ordinary `tools/pre-execute` Consumer. The intent and effect reviewers are private implementation capabilities passed within the shell provider; they do not create a public service with one internal caller, and the agent loop remains unchanged.

Fixed security decisions and ordered deployment rules run first. A deliberately small parser then admits literal read-only pipelines whose stages write only to stdout and whose resolved file operands stay in the workspace or platform temporary directory. Substitution, redirection, execution metacharacters, write flags, unresolved operands, and symlink escapes leave this fast path. Commands outside the parser continue to model review; parser incompleteness never grants permission.

Unmatched commands produce two independent requests. The intent route receives bounded direct-user text and the acting model's stated intent, but not the command. The primary effect route receives the exact bounded command and working directory, but no user or acting-model intent. Both run concurrently. Configuration requires three distinct intent, primary-effect, and secondary-effect routes, and runtime excludes an effect route matching the acting model. An intent route matching the acting model fails closed because self-review is not independent.

Auxiliary output uses a closed shell-effect vocabulary. Strict parsers reject extra fields, unknown effects, invalid risk values, conflicting allow and forbid sets, and output beyond deployment bounds. The intent reviewer reports alignment and user-authorized or forbidden effects. The effect reviewer reports only direct command effects. Deterministic host code combines the validated evidence: baseline reads and local computation may pass, workspace mutation requires aligned and explicit intent, and network, credential, process-control, privilege, external-mutation, or destructive effects require approval. Models provide evidence; they do not own the final policy rule.

The intent and primary effect requests share exact in-flight inputs and normally cost the slower route's wall time rather than their sum. A secondary effect route runs only when the primary route returns no valid effect evidence; it never overrides a validated sensitive effect. A superseded malformed or unavailable primary opinion remains in the audit but does not inflate the risk of a validated secondary decision. Caller cancellation releases its waiter and cancels shared work when no waiter remains.

Classifier-request events store the route, purpose, fixed system prompt, reconstruction selectors, and input bounds before dispatch. Raw user text remains in `user/message`; raw tool arguments remain in `tool/call`. The invariant verifies the current open turn, matching call, purpose/input selector agreement, and any referenced direct-user message. This retains exact reconstructibility without keeping a second raw copy.

An effective `ask` immediately enters the existing approval service. The enforcer has no retry threshold or process-local opportunity state. A grant applies to the exact call once; deterministic denials never become approvable.

## Alternatives considered

**Keep one classifier and tune its prompt.** Rejected because the same model would still receive authorization context and command effects together, so the prompt could discourage contamination but could not make the evidence independent. It would also leave free-form model categories in control of the decision.

**Publish a separate intent-review Service Definition.** Rejected because only the shell policy provider consumes this interpretation. A private capability closure preserves the plugin boundary without adding an incomplete public seam or speculative provider ecosystem.

**Adopt Tree-sitter Bash for the read fast path.** Rejected for this bounded grammar. The Node bindings add native build and platform packaging work, while an AST still needs repository-owned semantic rules for options, redirection, resolved paths, and symlink escape. A fail-closed literal parser keeps the grant surface smaller and has direct invalid-case tests. A broader grammar can justify a maintained parser dependency later.

**Let reviewers return open-ended effects.** Rejected because synonyms and invented categories make host policy ambiguous and reproduce the original model-owned threshold problem. The closed list costs category maintenance but makes every accepted result executable by deterministic code.

**Retain the exact-call retry before approval.** Rejected because repeating identical arguments adds no evidence, creates model-visible friction on false positives, and duplicates the one-shot ownership already provided by `ctx.approval`.

## Consequences

Common literal inspection pipelines avoid all auxiliary latency. Other commands normally make two small concurrent requests instead of one mixed request; missing or invalid primary effect evidence can make a third. The extra token cost buys independent evidence and is bounded by fixed prompts, closed JSON, shared in-flight requests, and secondary-on-demand dispatch.

The closed effect vocabulary may need deliberate extension as new shell capabilities appear. Unknown effects fail closed, so an omitted category causes approval rather than permission. The read parser likewise favors false negatives: unsupported flags or syntax use model evidence instead of expanding the deterministic grant surface by guesswork.

False-positive `ask` decisions now reach a person on the first call. This can surface more approval prompts when classifiers are uncertain, but it removes the mandatory retry turn and keeps the existing durable approval audit as the only human-decision mechanism.

Focused unit tests cover strict evidence parsing, host combination rules, read-pipeline escape cases, concurrent and shared dispatch, route independence, fallback, timeout, cancellation, and disposal. A real Loader composition covers the full provider-consumer lifecycle, and the keyless Daedal snapshot drives the assembled profile through independent intent and effect routes. A self-skipping real-provider test uses fixed synthetic input under the platform temporary directory to distinguish local inspection from approval-requiring network access without disclosing repository content.
