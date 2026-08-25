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
  - REQ:integration/forge-runtime#c-project-workspaces
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
The Web composition accepts an authenticated Forge project catalog, reconciles
one managed Workspace per entry, and honors a registered-workspace deep link
without falling back to a different project.

The released adapter additionally derives one Forge-owned credential socket
from the immutable executor lease, refuses missing or non-socket endpoints,
passes only that endpoint to the action MCP, and configures Forge Intellect to
wrap each model-requested child command in the shipped Landlock launcher with
read access to the runtime and write access only to that session workspace and
temporary directory. Ambient credentials and sibling executor roots remain
unavailable to the child process.
