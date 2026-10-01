---
id: TASK:ui/session-info-tab
type: task
status: accepted
summary: Turn the Web client's Spend conversation view into a general Info view backed by a new host sessionInfo Remote.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/session-info-tab#c-snapshot
  - REQ:ui/session-info-tab#c-degrade
  - REQ:ui/session-info-tab#c-ui
  - REQ:ui/session-info-tab#c-spend
labels: [ui, web, session]
assignee: carlo
---

# Session information tab

## Acceptance

The shipped Web profile adds the host package `@deepseek-ai/dsh-session-info` at `packages/api/session-info`, publishing one Typert Remote method, `sessionInfo.read({ sessionId })`, and mounts it as the `session-info` row. The reading assembles the session identity, the Workspace registration accounting it, the host execution environment, and the effective command-authorization policy from the owners of each fact — the Session header, the registered projection units, the sandbox policy, the approval service, the Workspace registry, and the host process.

Every fact whose owning service is not composed is reported as an explicit `null`, never a fabricated value, and a session absent from the live registry answers a stated `session-unavailable` failure.

The client package `@deepseek-ai/dsh-client-ui-session-info` at `packages/client/ui-session-info` replaces the former OpenRouter spend view: it contributes one `conversation.view` entry with id `info`, label "Info", and `order: 20`, rendering the Session, Workspace, Environment, and Command-authorization blocks plus the OpenRouter spend block read from the unchanged `openrouterSpend` Remote. The spend reading settles independently, so its failure degrades only that block. All copy is locale-owned.

Keyless host package tests cover the assembled snapshot, the explicit null degradation, the unavailable-session answer, and the aborted request. Client tests cover loading, the settled sections, workspace absence, unset policy values, spend and info failures, refresh, and the plugin registration and dispatch. A Loader-backed Web-profile slice verifies the client contribution against scripted Remotes.
