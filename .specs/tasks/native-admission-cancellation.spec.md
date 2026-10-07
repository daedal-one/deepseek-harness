---
id: TASK:tasks/native-admission-cancellation
type: task
status: accepted
summary: "Cancel native admission before starting asynchronous capability or event work."
owners: [carlo]
progress: done
addresses: ["IFC:frontend/daedal-dsh-client"]
---

# Native admission cancellation

## Plan

Invoke capability admission and forwarded listener work only after their abort race owns the returned Promise. A cancelled opening frame starts no new capability read. Cancellation contains any in-flight rejection without publishing readiness or retrying mutations.

## Acceptance

A deterministic late-opening regression proves no capability read or readiness publication after cancellation. Existing gateway admission and waterfall tests pass, as does the companion partial-file staging lifecycle through the rebuilt portable artifact. Documentation and relevant source checks cover the owning helper.

## Evidence

The gateway cancellation and admission tests pass, as do the focused companion runtime tests using the rebuilt portable Client. The Host and Client programs compile; portable application packaging, contract lint and documentation gates pass. The installed archive records source `a17881c3c7962b5ecf9bcfea99b99fcf0fc19c0d`. This qualifies local source and artifacts, not server deployment.
