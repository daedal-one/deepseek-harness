---
id: TASK:tasks/native-admission-cancellation
type: task
status: accepted
summary: "Cancel native admission before starting asynchronous capability or event work."
owners: [carlo]
progress: in_progress
addresses: ["IFC:frontend/daedal-dsh-client"]
---

# Native admission cancellation

## Plan

Invoke capability admission and forwarded listener work only after their abort race owns the returned Promise. A cancelled opening frame starts no new capability read. Cancellation contains any in-flight rejection without publishing readiness or retrying mutations.

## Acceptance

A deterministic late-opening regression proves no capability read or readiness publication after cancellation. Existing gateway admission and waterfall tests pass, as does the companion partial-file staging lifecycle through the rebuilt portable artifact. Documentation and relevant source checks cover the owning helper.
