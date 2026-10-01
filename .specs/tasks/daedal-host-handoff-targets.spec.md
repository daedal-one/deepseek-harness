---
id: TASK:sandbox/daedal-host-handoff-targets
type: task
status: accepted
summary: Select receiver-owned host handoff profiles with independent permission policies.
owners: [carlo]
progress: done
addresses:
  - REQ:sandbox/host-maintenance#c-daedal-handoff
  - REQ:sandbox/host-maintenance#c-world
  - REQ:sandbox/host-maintenance#c-handoff
labels: [sandbox, daedal, interaction]
assignee: carlo
---

# Host handoff target profiles

The receiver publishes an operator-configured catalog of target profiles. Each target fixes its identifier, display name, workspace, agent preset, and permission preset. The source explicitly selects a catalog identifier. Human confirmation displays the host, target profile, workspace, sandbox and approval policy, and complete task. The receiver rejects unknown targets or changed approved settings before admitting work, creates a separate session with the destination settings, and transfers only the task summary and source reference. Source settings remain unchanged. Source agent presets never select destination authority.

Execution classification follows the providers used by the agent's shell. Auxiliary host filesystem or subprocess providers inside a preset must not classify ordinary VM work as host execution. Preserve explicit host admission and execution-world consistency checks.

A host coding session can hand off to a different configured profile and policy through the same explicit confirmation. Being on the host does not imply that the current session has the maintenance permissions.

Verify independent source and destination presets and permissions, target discovery, unknown and changed targets, human approval, duplicate delivery, cancellation, and auxiliary host providers in a VM composition. Update model-visible snapshots, the real Loader session admission test, and the configuration documentation. Retain uncertain-acceptance reporting and bounded authenticated transport.

## Acceptance

Source validation passes 281 focused handoff, permission, and preset tests, with 100% handoff package coverage. The keyless recorded-session replay passes. The real Web Loader composition creates a maintenance session with separate tools and a read-only policy, denies a model-facing write, preserves the coding session, and admits one model turn on duplicate delivery. The supported build passes with the matching installed macOS SDK. Server activation and target configuration remain separate from this source acceptance.
