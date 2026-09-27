---
id: TASK:sandbox/agent-shell-credentials
type: task
status: accepted
summary: Resolve session-scoped credential grants into agent shell processes.
owners: [carlo]
progress: done
addresses:
  - REQ:sandbox/isolated-execution-world#c-secrets
---

# Agent shell credentials

## Behavior

A deployment can grant a stored credential reference to explicit root-session lineages without storing secret values in composition files. The shell environment owner follows live parent-session headers, resolves each applicable reference for every foreground or background command, and passes only those values as explicit process environment entries. Unrelated sessions, executions without an Agent, and descendants whose ancestry is unavailable receive no credential. A missing configured credential fails the authorized command before process allocation and names only the reference.

Ambient credentials remain scrubbed. Container execution accepts trusted explicit ordinary environment entries while continuing to restrict the Harness-owned `DSH_*` namespace. Credential values do not enter session events, workspace files, checkpoints, or diagnostics.

## Validation

Cover root and nested-child authorization, unrelated-session and agentless denial, malformed grants, missing values, foreground bash and pwsh requests, ambient-secret scrubbing, explicit container credential admission, restricted `DSH_*` names, and documentation of the operator path.
