---
id: TASK:guard/tool-policy-deferred-approval
type: task
status: accepted
summary: Return automatic policy denials to the acting agent before escalating a consecutive identical call to the user.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy#c-approval
  - REQ:guard/tool-policy#c-durability
  - REQ:guard/tool-policy#c-evidence
labels: [guard, tool-policy, permissions, approval, behavior]
assignee: carlo
---

# Deferred tool-policy approval

## Acceptance

An automatic `ask` verdict returns the provider's bounded reason to the acting agent as a denied tool result without opening human approval. The result names the current attempt and configured threshold so the agent can change approach or deliberately retry the exact call. The third consecutive call with the same tool and canonical arguments in the same turn opens the existing approval service by default; repeated identical calls remain approval-eligible after a rejection, while an intervening call, turn change, non-ask verdict, or successful approved execution starts a new chain. The threshold is deployment configuration, provider and effective decisions remain durable, deterministic denials never become approvable, and focused runtime plus keyless assembled-profile coverage proves the complete path.
