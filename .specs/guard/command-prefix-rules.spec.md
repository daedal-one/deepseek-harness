---
id: REQ:guard/command-prefix-rules
type: requirement
status: accepted
level: MUST
summary: Deterministic shell rules match literal argument prefixes and validate examples before activation.
owners: [carlo]
refines: [REQ:guard/tool-policy]
---

# Command-prefix rules

:::{requirement id="command-prefix-rules" level="MUST"}
- {#c-matching} Configured prefix rules MUST match ordered literal argument tokens, support explicit alternatives, retain explanations, and use the strictest matching decision independent of rule order.
- {#c-validation} Positive and negative example commands MUST be checked against their rule at activation; empty or invalid patterns and contradictory examples MUST fail with a corrective diagnostic.
- {#c-shell} Parsing MUST require explicit approval for unsupported shell execution syntax when prefix rules are active, including expansion, substitution, redirection, and compound commands. Absolute executable paths MUST not silently match basename rules.
- {#c-composition} Fixed security denials and mandatory escalation MUST precede configurable rules. Prefix-rule restrictions MUST not be weakened by legacy glob rules; unmatched commands MUST retain existing independent review. Existing configurations without prefix rules MUST retain their behavior.
- {#c-evidence} Focused parser, Loader, provider, and recorded-session tests MUST prove valid literal commands avoid auxiliary review and dangerous or ambiguous commands do not inherit an allow decision.
:::
