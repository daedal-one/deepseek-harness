---
id: TASK:sandbox/host-maintenance
type: task
status: accepted
summary: Add an explicit host-maintenance profile option and qualify a recoverable systemd deployment.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/host-maintenance#c-profile
  - REQ:sandbox/host-maintenance#c-world
  - REQ:sandbox/host-maintenance#c-composition
  - REQ:sandbox/host-maintenance#c-handoff
  - REQ:sandbox/host-maintenance#c-deployment
  - REQ:sandbox/host-maintenance#c-evidence
labels: [sandbox, profiles, deployment]
assignee: carlo
---

# Host maintenance profiles

Implement the launch-profile option using existing sandbox and permission services. Keep execution providers explicit, exercise host behavior without a model API, and document the separate-profile handoff. Qualify the candidate alongside the running service before systemd activation, preserving companion integration and the previous release.
