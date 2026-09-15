---
id: TASK:web/local-recovery-form-origin
type: task
status: accepted
summary: Preserve the browser origin when submitting authenticated recovery forms.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:web/local-recovery#c-access
  - REQ:web/local-recovery#c-evidence
labels: [web, recovery]
assignee: carlo
---

# Recovery form origin

## Acceptance

Authenticated same-origin browser form submissions select the requested recovery action. Cross-origin and opaque-origin requests remain rejected, and token-bearing authentication redirects suppress referrers. Focused HTTP tests and a real browser button submission through the installed proxy verify the behavior.
