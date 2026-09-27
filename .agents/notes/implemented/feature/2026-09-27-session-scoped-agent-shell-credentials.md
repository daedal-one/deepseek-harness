# Agent Note: Session-scoped credentials for agent shell processes

Status: implemented

## Problem

Provider credentials stored through the Harness credential service authenticate host-owned model calls, but agent-run experiments execute in child processes whose ambient credential-looking variables are scrubbed. Copying a secret into a composition file, broadly inheriting the host environment, or granting a deployment-wide shell credential would make unrelated sessions able to read it.

## Decision

The shell environment plugin accepts credential grants pairing one stored reference with explicit root-session ids. For each foreground or background shell call, it follows the calling Agent's live parent-session lineage and resolves only the grants whose root occurs in that lineage. An unrelated session, an agentless execution, a detached ancestry, or a cycle fails closed. Credential values resolve through `ctx.credentials` for every authorized command, so rotation reaches the next call without a restart.

Container subprocesses accept trusted explicit ordinary environment entries after replacing the image and host environments. They retain the restricted `DSH_*` namespace and the fixed `DSH_HOME` path. This distinguishes a deployment-authorized, session-scoped credential from ambient host state without adding a model-facing secret-selection parameter.

## Alternatives considered

**Grant the credential to the whole deployment.** This gives every conversation using that composition the experiment's external authority.

**Inherit the harness environment.** This exposes every ambient credential to every agent process and makes the child environment depend on how the server happened to start.

**Write an `.env` file into each workspace.** Workspace files are checkpointed, returned, and inspectable, so this persists the secret beyond the operation that needs it.

**Add a key argument to the shell tool.** A model-facing value or reference selector lets model input choose credential authority and risks recording secret material in tool events.

## Consequences

Operators must name the stored reference and the root session ids that may use it. Child authorization depends on live session ancestry and intentionally disappears if that ancestry cannot be established. Configuring a missing reference makes authorized shell calls fail before process allocation until the value is supplied. Commands intentionally receive the selected secret and can print or persist it; the Harness prevents accidental ambient inheritance and persistence by its own control plane, but it cannot protect a credential from the command authorized to use it.
