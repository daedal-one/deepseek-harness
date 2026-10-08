---
id: REQ:ui/session-info-tab
type: requirement
status: accepted
level: MUST
summary: Users see the current session's identity, workspace, execution environment, and effective command-authorization policy in one Web conversation view.
owners: [carlo]
refines: []
categorized_under: []
---

# Session information tab

## Context

The shipped Web client's session conversation view exposes only Chat, Trajectory, and OpenRouter Spend. A user cannot see what session they are in, which workspace accounts it, whether commands run on the host or in a container, or which sandbox and approval policy is in force, without reading the transcript or the configuration files.

:::{requirement id="session-info-tab" level="MUST"}
- {#c-snapshot} The host MUST publish one Remote read addressed by session id that returns the session's identity (id, title, agent preset, latest durable model route, working directory, turn and step counts), the Workspace accounting it when one is registered, the host execution environment (verified placement, a process-local identity that is equal exactly when two sessions resolve to the same execution world on that host, platform, architecture, OS release, Node version, home directory), and the effective command-authorization policy (effective and default file policy, resolved workspace boundary, effective and default approval policy, and the effective permission preset with its declared description).
- {#c-degrade} Every fact whose owning service is not composed MUST be reported as an explicit null, never a fabricated value, and a session absent from the live registry MUST answer a stated `session-unavailable` failure.
- {#c-ui} The Web client MUST present the reading in the existing session conversation view as a single locale-owned Info tab alongside Chat, Trajectory, and Prompt.
- {#c-spend} The OpenRouter spend reading MUST remain a separate Remote and a separate view block whose failure degrades only that block.
:::
