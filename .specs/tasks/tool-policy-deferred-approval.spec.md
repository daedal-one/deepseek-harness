---
id: TASK:guard/tool-policy-deferred-approval
type: task
status: accepted
summary: Return automatic policy denials with an explicit, exact-call user approval route.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy#c-approval
  - REQ:guard/tool-policy#c-durability
  - REQ:guard/tool-policy#c-evidence
labels: [guard, tool-policy, permissions, approval, behavior]
assignee: carlo
---

# Explicit tool-policy approval

## Acceptance

An automatic `ask` verdict returns the provider's bounded reason and the denied call id with instructions to use `request_tool_approval` if the action is still necessary. Repeated calls never open approval and the retry threshold configuration is absent. The approval tool accepts a completed policy-denied call id and justification, requests a decision through the existing approval service, and grants only the next exact matching call in the same open turn. Canonical argument identity, durable grant reconstruction, concurrent calls, native and PTC calls, disabled or unavailable approval, rejection, cancellation, turn changes, and deterministic denials are covered by focused tests. A keyless assembled profile and recorded Session verify denial, explicit approval, and one execution without repeated automatic-review attempts.
