---
id: TASK:sandbox/main-host-consolidation
type: task
status: accepted
summary: Preserve host histories and independent execution policies in one main Web server.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/host-maintenance#c-world
  - REQ:sandbox/host-maintenance#c-daedal-handoff
  - REQ:sandbox/host-maintenance#c-deployment
  - REQ:guard/tool-policy#c-effects
labels: [sandbox, daedal, interaction]
assignee: carlo
---

# Main server host consolidation

## Intent

The existing main Web server must serve ordinary container conversations and separate operator-approved host conversations without changing a source conversation's preset, execution environment, or permission policy. A catalog-selected handoff must create its own host-backed session, verify the effective destination providers and permission knobs before prompting, and retain human confirmation, authentication, bounded transport, and duplicate-delivery guarantees.

Existing host histories must retain their original Session IDs, headers, lineage, committed generations, and byte prefixes. Operator-owned admission must bind exact restored identities and verified history prefixes to an isolated host execution composition before publication, independently of the original logical agent-preset identity. The admission must fail closed on mismatched preset, workspace, lineage, or history, preserve recorded sandbox and approval knobs, distinguish host and container standing compositions sharing one logical preset, and preserve host execution for legitimate descendants. No import may fabricate a post-start preset selection or use an arbitrary resume-time preset escape.

The shell policy's contained-world exemption must inspect the requesting agent's effective filesystem and subprocess providers. A root container provider must not exempt a host command. Ordinary verified container commands retain their existing exemption, and unavailable host review or approval must fail closed.

## Verification

Qualify original-byte imports, ordinary and admitted resumes, child reconstruction, restart, invalid admission, provider mismatch, post-start selection rejection, and real-controller handoff with keyless tests. Include a model-visible recorded-session case for the admitted execution composition. Keep model turns and tools blocked in copied live-history qualification. Deployment must use a quiescent snapshot with compatible rollback, verify the actual release and authenticated main UI, preserve the companion routes and original host archive, retire only the maintenance service and TCP 3083 route after live preservation checks, and restore the sync timer.
