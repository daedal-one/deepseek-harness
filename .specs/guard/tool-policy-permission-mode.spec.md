---
id: REQ:guard/tool-policy-permission-mode
type: requirement
status: accepted
level: MUST
summary: Deployments expose model-backed tool policy as an explicit permission mode without changing the default enforcer behavior.
owners: [carlo]
refines:
  - REQ:guard/tool-policy
categorized_under: []
---

# Tool-policy permission mode

## Context

Model-backed authorization is useful between workspace confinement and fully
unrestricted execution, but mounting its plugins must not silently apply it to
every permission preset or change existing tool-policy deployments.

:::{requirement id="tool-policy-permission-mode" level="MUST"}
- {#c-activation} The tool-policy enforcer MUST let deployment configuration
  restrict evaluation to selected effective sandbox modes and approval
  policies, derived from the session's durable mechanism events; an omitted
  restriction MUST preserve unconditional enforcement.
- {#c-daedal} The Daedal host configuration MUST expose a named policy-reviewed
  preset after `workspace-write` and before `danger-full-access`; it MUST pair
  full file access with human approval availability and activate model-backed
  policy only for that pair.
- {#c-existing-modes} Daedal `read-only` and `workspace-write` MUST retain their
  sandbox behavior without auxiliary policy calls, while `danger-full-access`
  MUST retain its no-prompt behavior without auxiliary policy calls.
- {#c-plugin} The change MUST use the existing permission, sandbox, approval,
  and tool-policy plugin extension points without changing the agent loop or
  adding a Daedal-specific UI branch.
- {#c-evidence} Focused unit, Loader-composition, keyless assembled-application,
  snapshot, and real browser evidence MUST cover mode order, switching,
  classifier activation, bypass, and the existing Full access risk gate.
:::
