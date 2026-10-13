---
id: TASK:guard/guard-message-reconciliation
type: task
status: accepted
summary: Reconcile the deferred tool-policy approval options with the loop-hygiene repeat reminder in the messages and package contracts each guard owns.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy#c-approval
labels: [guard, tool-policy, docs]
assignee: carlo
---

# Guard message reconciliation

## Acceptance

The deferred tool-policy denial result names the current attempt and configured threshold and presents both accepted actions explicitly: varying the approach is the expected response, while deliberately repeating the exact call is how the acting agent reaches the user when the retry is genuinely wanted. The same result states that an intervening different call or turn change resets the chain and that a deterministic denial never becomes approvable. The `dsh-tool-policy-enforcer` and `dsh-repeat-tool-reminder` READMEs each record that the approval threshold counts consecutive identical `ask` verdicts for human escalation while the reminder counts consecutive repeated tool calls for loop hygiene, and that neither mechanism suppresses the other. The pinned result text and the focused enforcer tests agree with the shipped message.
