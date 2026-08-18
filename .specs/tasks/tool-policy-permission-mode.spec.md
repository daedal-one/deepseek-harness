---
id: TASK:guard/tool-policy-permission-mode
type: task
status: accepted
summary: Expose Daedal model-backed tool authorization as a permission preset between Workspace Write and Full access.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy-permission-mode#c-activation
  - REQ:guard/tool-policy-permission-mode#c-daedal
  - REQ:guard/tool-policy-permission-mode#c-existing-modes
  - REQ:guard/tool-policy-permission-mode#c-plugin
  - REQ:guard/tool-policy-permission-mode#c-evidence
labels: [guard, tool-policy, approval, permissions, daedal]
assignee: carlo
---

# Daedal tool-policy permission mode

## Acceptance

Daedal advertises the deployment-defined policy-reviewed preset in the shared
permission selectors. Selecting it records the existing sandbox, approval, and
preset events, enables the independently reviewed tool policy for subsequent
supported calls, and keeps genuine asks on the existing approval path. The
neighboring restricted and unrestricted modes bypass auxiliary policy review,
and generic enforcer compositions remain unconditionally active unless they
configure activation restrictions.
