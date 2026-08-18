# dsh-tool-policy-shell

English | [中文](README.zh.md)

This effect-scoped provider interprets explicitly mapped shell tools through the existing `ctx.toolPolicy` service. It combines fixed security checks, ordered deployment rules, a conservative parsed read-only set, and bounded independent intent and command-effect review. Bash and PowerShell are supported by configuration; neither tool name nor argument name is built in.

## Configuration and behavior

`mappings` names each supported tool plus its command and optional acting-model intent argument. `intent`, `primary`, and `secondary` select three distinct `ctx.llm` provider/model routes. Every timeout, input/output bound, summary/reason cap, effect count, and ordered command rule is required configuration. At runtime, a route matching the acting model is excluded; missing independent evidence fails closed.

Host-root destruction primitives and protected credential paths are denied before rules or model calls. Unconditional Git force pushes, remote deletes, and mirrors ask; `--force-with-lease` and `--force-if-includes` remain eligible for ordinary evaluation. Rules use glob-like whole-command matching, the last match wins, and an allow rule cannot admit a command containing shell metacharacters.

The parsed fast path accepts only literal read pipelines whose stages write to stdout and whose resolved files stay in the workspace or platform temporary directory. Substitution, redirection, execution metacharacters, write flags, unresolved paths, and symlink escapes leave the fast path.

For unmatched commands, the intent route receives only bounded direct-user and acting-model intent; the primary effect route receives only the exact bounded command and working directory. They run concurrently with temperature zero and strict JSON framing. Model output is validated against a closed effect vocabulary, then host code derives the verdict. A secondary effect route runs only when the primary route does not return valid effect evidence; it never overrides a validated sensitive effect. Invalid, unavailable, failed, timed-out, conflicting, or out-of-vocabulary evidence becomes `ask`; caller cancellation remains cancellation.

## Security behavior

Diagnostics retain only bounded sanitized summaries, reasons, and closed effects. Raw user text and command arguments remain in their existing `user/message` and `tool/call` events. Classifier-request events record routes, prompts, selectors, and bounds so each request is reconstructible without duplicating either raw input.

## Model Experience

### Conditional authorization feedback

#### What the model sees

This provider adds no main prompt. The enforcement consumer renders denial or approval feedback from its `tools/pre-execute` verdict.

#### Token effect

Known fixed, rule, and parsed read-only cases spend no classifier tokens. Other calls spend two concurrent auxiliary requests; missing or invalid primary effect evidence spends one further request. Wall time is normally the slower of the intent and primary effect routes, not their sum.

#### KV Cache effect

Classifier requests use a fixed system prefix and stable JSON field order, improving auxiliary cache reuse. They do not modify the main conversation prefix.

## Known Limitations and Deferred Work

- The fast path intentionally recognizes only a small shell grammar; commands outside it use independent model evidence.
- A bounded command that exceeds its configured limit asks instead of sending a truncated command to a classifier.
