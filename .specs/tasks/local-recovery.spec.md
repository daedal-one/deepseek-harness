---
id: TASK:web/local-recovery
type: task
status: accepted
summary: Implement and verify the local development proxy and explicit last-good fallback.
owners: [carlo]
progress: done
addresses:
  - REQ:web/local-recovery#c-control
  - REQ:web/local-recovery#c-good
  - REQ:web/local-recovery#c-switch
  - REQ:web/local-recovery#c-access
  - REQ:web/local-recovery#c-evidence
labels: [web, development, recovery]
assignee: carlo
---

# Local recovery proxy

## Acceptance

A standalone installed repository tool serves a fixed loopback origin and a recovery page independently of the Harness. Manual controls retain a confirmed committed build, select it after development startup fails, and return to current development. Focused process and transport tests verify isolation, provenance, access checks, streaming, and teardown; a local assembled Harness smoke verifies browser access and actual code editing through recovery.
