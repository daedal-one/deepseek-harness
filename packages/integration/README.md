---
description: "Forge project roster and session execution integrations for deployments with server-owned workspaces."
kind: "package-group"
---

# integration/ — Forge deployments

## Summary

Connect Forge-owned projects and execution scopes to Harness workspaces and sessions. Forge deployment adapters translate server-owned workspaces into Harness configuration. The independent verification profile also works directly in a local repository.

## Packages

- [forge-project-workspaces](forge-project-workspaces/README.md) reconciles project roots into the workspace roster.
- [forge-session-adapter](forge-session-adapter/README.md) configures the execution scope and command restrictions for an Agent.

- [forge-intellect](forge-intellect/README.md) verifies local code against durable specifications.

## Related documentation

The [workspace subsystem](../../docs/subsystems/workspace.md) owns workspace identity. The [session subsystem](../../docs/subsystems/session.md) owns the durable session lifecycle.

The [verification subsystem](../../docs/subsystems/forge-intellect.md) owns local plans, reviews and native evidence authority.
