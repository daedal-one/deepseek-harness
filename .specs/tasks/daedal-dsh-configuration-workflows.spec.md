---
id: TASK:tasks/daedal-dsh-configuration-workflows
type: task
status: accepted
summary: "Expose configuration and workflow controls."
owners: [carlo]
progress: pending
addresses: ["REQ:frontend/daedal-dsh#c-configuration", "REQ:frontend/daedal-dsh#c-workflows"]
blocked_by: ["TASK:tasks/daedal-dsh-native-client"]
---

# Expose configuration and workflow controls

## Plan

Expose approved model/provider/preset, settings, plugin, skill and memory/context operations through their owners. Extend read-only workflow/schedule views with required permitted controls. Keep provider secrets host-side, plugin management privileged and workflow state durable.

## Acceptance

Model and preset selection, credential redaction, settings conflicts, supported plugin management recovery, goal/job/workflow outcomes and configured schedule lifecycle are verified through native remotes. Missing capabilities remain explicit. No frontend-owned scheduler, goal loop or direct store editing is required.
