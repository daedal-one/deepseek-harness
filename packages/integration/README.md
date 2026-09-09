---
description: "Forge project roster and session execution integrations for deployments with server-owned workspaces."
kind: "package-group"
---

# integration/ — Forge deployments

## Summary

Connect Forge-owned projects and execution scopes to Harness workspaces and sessions. Forge allocates worktrees, authorization, and credentials; these adapters translate those decisions into Harness configuration.

## Packages

- [forge-project-workspaces](forge-project-workspaces/README.md) reconciles project roots into the workspace roster.
- [forge-session-adapter](forge-session-adapter/README.md) configures the execution scope and command restrictions for an Agent.

## Related documentation

The [workspace subsystem](../../docs/subsystems/workspace.md) owns workspace identity. The [session subsystem](../../docs/subsystems/session.md) owns the durable session lifecycle.
