---
id: TASK:guard/guard-message-reconciliation
type: task
status: accepted
summary: Reconcile explicit tool-policy approval with the loop-hygiene repeat reminder in the messages and package contracts each guard owns.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy#c-approval
labels: [guard, tool-policy, docs]
assignee: carlo
---

# Guard message reconciliation

## Acceptance

The tool-policy denial result directs the acting agent to `request_tool_approval` with the denied call id and a justification when the action remains necessary. Repetition never triggers approval. The tool-policy enforcer and repeat-tool-reminder READMEs state that explicit approval and repeated-call reminders are independent. A grant permits one exact retry; deterministic denials remain unapprovable. The pinned result text and focused enforcer tests agree with the message.
