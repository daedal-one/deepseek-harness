---
id: TASK:ui/trajectory-tool-result-detail
type: task
status: accepted
summary: Preserve deferred tool-result identity and expose full result loading in Trajectory.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/poor-connection-resilience#c-history
  - REQ:ui/poor-connection-resilience#c-evidence
labels: [ui, trajectory]
---

# Trajectory tool-result detail

## Scope

Retain the history entry's deferred-result marker in the Trajectory projection and its exact result sequence in the ledger. Show an unloaded-result label and an explicit full-result action in the selected record's Summary and Result panels. Fetch through the existing authorized Session detail reader, preserving complete content, errors, paging, retention, and cancellation ownership.

## Acceptance

Completed deferred results remain completed and never appear empty. A user can load an existing result without another model request or tool execution; successful hydration replaces only that result. Failure preserves the unloaded result and allows explicit retry. Ordinary empty, running, and fully loaded results retain their behavior. Projection and component tests cover the distinctions, and a keyless recorded Session drives the assembled Web loading flow.
