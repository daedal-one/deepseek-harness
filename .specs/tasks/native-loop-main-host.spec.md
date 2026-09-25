---
id: TASK:sandbox/native-loop-main-host
type: task
status: accepted
summary: Run the authorized migration loop as a host-maintenance conversation in the existing DSH Web Host.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/host-maintenance#c-world
  - REQ:sandbox/host-maintenance#c-deployment
  - REQ:sandbox/host-maintenance#c-evidence
labels: [sandbox, schedule, deployment]
assignee: carlo
---

# Native loop in the existing Host

Carlo requires the migration loop in his existing DSH Web UI, without a separate Web service or new Tailscale route. Add explicit operator admission for a trusted host-backed conversation preset. Validate its scoped filesystem and process services before excluding it from container preparation; ordinary conversations and their descendants retain their existing container lifecycle. A maintenance descendant inherits its parent's admission and scoped services. Refuse container-only workspace operations for a maintenance conversation.

Keep the stopped worker's Session history, current source and evidence intact. Activate one native scheduled continuation in the existing Host with an explicit checkpoint handoff, qualify host commands, visible conversation and timer delivery, and retain startup recovery without a second agent loop. Do not rewrite historical Session headers, weaken the existing container defaults, or enable a new network route.

Shell providers report an optional execution-world identity so admission can reject unproven or split provider compositions. A stopped container workspace releases its environment lease even when checkpoint publication fails; a still-live world retains exclusive ownership.

Internal preset filesystem and subprocess services for instruction loading and reviewed MCP transports MUST preserve ordinary container ownership when the preset has no scoped shell executor. The deployed Daedal composition must be qualified alongside the admitted maintenance composition.
