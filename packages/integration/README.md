---
description: "Project roster, execution, and confirmed host-session integrations."
kind: "package-group"
---

# integration/ — External execution integrations

## Summary

Connect externally owned projects and execution scopes to Harness workspaces and sessions. Forge allocates worktrees, authorization, and credentials; its adapters translate those decisions into Harness configuration. Daedal can transfer approved host maintenance to a separately configured host profile.

## Packages

- [daedal-handoff](daedal-handoff/README.md) supplies Daedal-only execution guidance and confirmed host-session transfer.
- [forge-project-workspaces](forge-project-workspaces/README.md) reconciles project roots into the workspace roster.
- [forge-session-adapter](forge-session-adapter/README.md) configures the execution scope and command restrictions for an Agent.

## Related documentation

The [workspace subsystem](../../docs/subsystems/workspace.md) owns workspace identity. The [session subsystem](../../docs/subsystems/session.md) owns the durable session lifecycle.
