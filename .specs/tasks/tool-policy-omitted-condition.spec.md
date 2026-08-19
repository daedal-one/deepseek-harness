---
id: TASK:guard/tool-policy-omitted-condition
type: task
status: accepted
summary: Restore unconditional tool-policy enforcement when Loader configuration omits the optional activation condition.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy-permission-mode#c-activation
  - REQ:guard/tool-policy-permission-mode#c-evidence
labels: [guard, tool-policy, config, bug-fix]
assignee: carlo
---

# Omitted tool-policy activation condition

## Acceptance

A Loader composition may omit the tool-policy enforcer configuration and boots
with unconditional enforcement. Configured activation lists remain non-empty,
and focused schema and real Loader-composition tests cover both cases.
