---
id: TASK:tasks/daedal-dsh-desktop-runtime
type: task
status: accepted
summary: "Integrate the Daedal desktop shell with DesktopHost."
owners: [carlo]
progress: pending
addresses: ["REQ:frontend/daedal-dsh#c-desktop", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-native-client"]
---

# Integrate the Daedal desktop shell with DesktopHost

## Plan

Expose the existing DesktopHost transport and installation/runtime contracts needed by the Daedal shell. Resolve reserved-profile ownership and handoff with the current desktop product. Keep bundled upstream Node, exact package identity, install locks, health checks and compatible rollback under one DSH owner.

## Acceptance

A clean-machine Daedal desktop installation boots the owned backend through DesktopHost, while attach mode leaves external hosts alive on client close. Lock conflicts, interrupted install/update, health-check failure, sleep/resume and compatible recovery pass. No renderer receives arbitrary process or package-management access.
