---
id: TASK:maintenance/rebased-ci-repair
type: task
status: accepted
summary: Repair fork CI provider wiring, clean-checkout fixtures, and English UI expectations after the upstream rebase.
owners: [carlo]
progress: in_progress
addresses:
  - REQ:ui/english-only
  - REQ:llm/provider-management
  - REQ:ui/poor-connection-resilience
labels: [maintenance, testing, ci]
assignee: carlo
---

# Rebased CI repair

## Acceptance

The fork's real-provider and installed-runtime workflows use the OpenRouter credential and endpoint contract. Keyless fixtures supply their own provider configuration and run without developer credentials. Unit tests resolve source modules on a clean checkout; assembled built-client scenarios run in their declared artifact lane. UI assertions match the maintained English dictionaries and current service interfaces. Workflow and documentation checks follow the current English-only and frozen-archive rules. CI failures remain visible, and unavailable credentials or runners are reported without treating skipped work as passing evidence.

Temporarily disable live OpenRouter CI, including installed-wheel live requests, and the master Linux and Windows self-hosted standby jobs while the fork lacks their credentials and runners. Keep keyless checks active and retain the disabled jobs for later restoration.
