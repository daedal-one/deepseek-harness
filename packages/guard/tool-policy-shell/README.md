# dsh-tool-policy-shell

English | [中文](README.zh.md)

This provider interprets explicitly mapped shell tools and combines fixed security checks, ordered deployment rules, a small read-only set, and bounded independent model classification. Bash and PowerShell are supported by configuration; neither tool name nor argument name is built in.

## Configuration and behavior

`mappings` names each supported tool plus its command and optional intent argument. `primary` and `secondary` select exact `ctx.llm` provider/model routes. Every timeout, input/output bound, reason/category cap, and ordered command rule is required configuration.

Host-root destruction primitives and protected credential paths are denied before rules or model calls. Unconditional Git force pushes, remote deletes, and mirrors ask; `--force-with-lease` and `--force-if-includes` remain eligible for ordinary evaluation. Rules use glob-like whole-command matching, the last match wins, and an allow rule cannot admit a command containing shell metacharacters.

Unmatched commands reach the primary classifier with temperature zero and strict JSON framing. The exact bounded auxiliary request is durable before dispatch. A primary denial gets an independent secondary opinion; only a low-risk allow below 50 with no sensitive or destructive category can override it. Every invalid, unavailable, failed, or timed-out classifier result becomes `ask`. Caller cancellation remains cancellation.

## Security behavior

Diagnostics retain only bounded sanitized reasons and categories. Raw command arguments remain in `tool/call` and are not duplicated in decision events. Pattern matching is intentionally conservative and does not parse a complete shell grammar; the model classifier handles commands outside the fixed cases.

## Model Experience

### Conditional authorization feedback

#### What the model sees

This provider adds no main prompt. The enforcement consumer renders retry or approval feedback from its `tools/pre-execute` verdict.

#### Token effect

Known hard-deny, ask, rule, and read-only cases spend no classifier tokens. Other calls spend one auxiliary request; a primary denial spends a second independent request.

#### KV Cache effect

Classifier requests use a fixed system prefix and stable JSON field order, improving auxiliary cache reuse. They do not modify the main conversation prefix.

## Known Limitations and Deferred Work

- The fixed checks cover high-confidence shell text patterns, not an AST for every shell dialect.
- A bounded command that exceeds its configured limit asks instead of sending a truncated command to a classifier.
