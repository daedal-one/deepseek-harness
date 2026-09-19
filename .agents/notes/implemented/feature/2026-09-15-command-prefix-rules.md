# Agent Note: Validated literal command-prefix rules

Status: implemented

## Problem

Whole-command globs do not express argument alternatives or verify an operator's example commands. An ordered allow can weaken a broader restriction, and treating the beginning of a compound shell input as permission can authorize a second operation that the rule never inspected.

## Decision

The [shell policy provider](../../../../packages/guard/tool-policy-shell/README.md#literal-argument-prefix-rules) accepts optional argument-prefix rules on explicitly declared POSIX mappings. Pattern positions hold literal strings or alternatives. Positive and negative examples are validated before provider registration. All matching prefixes combine as deny, then ask, then allow; the stricter result also wins against the legacy whole-command rules. The mechanism follows the literal-pattern and executable-example approach of [Codex execpolicy](https://github.com/openai/codex/blob/e9633d7a0226eac91c7a791dc4f92cf8f25df2ae/codex-rs/execpolicy/README.md).

The existing conservative shell parser has a literal-command mode that excludes expansion, substitution, redirection, compound execution, and backslash escapes. Quoting preserves literal tokens, and executable paths match exactly without basename normalization. With active prefix rules, unsupported syntax requires approval before any automatic read or model-review allow. Unmatched literal commands retain independent review and the existing parsed-read path. Fixed destruction and credential denials and mandatory Git escalation retain precedence over every configurable rule.

Legacy configurations and PowerShell mappings retain their behavior. Prefix rules require at least one POSIX mapping; misconfiguration fails at activation. Existing tool-policy events and approval handling record and enforce the resulting decision. The [independent evidence decision](../bug-fix/2026-08-18-independent-tool-policy-evidence.md) continues to own model review; the [deferred-approval decision](2026-08-24-deferred-tool-policy-approval.md) owns approval timing.

## Alternatives considered

**Replace existing glob semantics.** That would silently change deployed configurations. Prefix rules are additive, while conflicts with their restrictions resolve conservatively.

**Interpret arbitrary shell syntax or strip executable paths.** A small policy matcher cannot faithfully reproduce every shell, expansion, alias, or wrapper. Unsupported syntax asks, and paths remain explicit.

**Use independent model evidence to allow unsupported syntax.** That can undo a configured restriction hidden inside a compound command. Explicit approval preserves the operator's authority over that ambiguity.

## Consequences

Known literal commands receive reproducible decisions without tool-time classifier requests. Operators maintain examples beside rules and receive load errors for contradictions. Active prefix rules make compound commands and other unsupported syntax require approval, even when the legacy read parser accepts them. Parser, provider, Loader, and recorded-session coverage must preserve strictest precedence, token boundaries, example validation, hard denials, and guarded execution.
