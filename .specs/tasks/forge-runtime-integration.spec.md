---
id: TASK:integration/forge-runtime
type: task
status: accepted
summary: Implement the Forge adapter, accountable tool composition, specifications, documentation, and conformance tests.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:integration/forge-runtime#c-protocol
  - REQ:integration/forge-runtime#c-intent
  - REQ:integration/forge-runtime#c-actions
  - REQ:integration/forge-runtime#c-evidence
  - REQ:integration/forge-runtime#c-policy
  - REQ:integration/forge-runtime#c-lifecycle
  - REQ:integration/forge-runtime#c-compatibility
labels: [forge, adapter, forge-spec, forge-intellect, conformance]
assignee: carlo
---

# Forge runtime integration

## Acceptance

The repository has a valid forge-spec v0.6 tree backed by Forge Intellect. The
adapter boots through a real Cordis composition, rejects incompatible or
unaccountable startup, translates supported commands and durable events, keeps
idempotent retries side-effect free, and passes a keyless Forge conformance
scenario with an actual Forge Intellect action provider.
