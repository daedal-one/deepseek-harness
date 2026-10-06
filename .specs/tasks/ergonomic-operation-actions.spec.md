---
id: TASK:tools/ergonomic-operation-actions
type: task
status: accepted
summary: Offer ordinary single-action calls and preserve bounded executed evidence when decision checkpoints fail.
owners: [carlo]
progress: done
addresses:
  - REQ:tools/operations#c-planner
  - REQ:tools/operations#c-policy
  - REQ:tools/operations#c-hard-stops
  - REQ:tools/operations#c-evidence
  - REQ:tools/operations#c-verification
labels: [tools, operations, experimental]
---

# Ergonomic operation actions

## Scope

Make `tool` and ordinary `arguments` sufficient for a single action, with an optional goal and an explicit resolver-owned default. Retain `plan` for existing concise sequences and detailed programs; reject mixed requests before effects. Present the single action first and keep execution limits out of ordinary model instructions.

Separate complete feedback to the planner from the smaller decision observation budget. Return bounded complete observations even when a later decision checkpoint fails, while retaining the failure state and preventing later dispatch. Explain which steps completed and that completed mutations must not be repeated. Preserve every permission, evidence-completeness check, judgment limit, recording barrier and cancellation rule.

## Acceptance

Real scoped execution covers single reads, small edits, rejection before effects, complete output exceeding the judgment observation limit, provider preparation failure after a completed action, and no subsequent action or automatic retry. Feedback has an independently configured byte bound and never silently clips values. Keyless recorded Sessions and SDK projections pin model-visible requests and recoverable checkpoint failures; live model evidence remains separate.
