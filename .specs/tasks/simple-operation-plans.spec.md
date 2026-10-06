---
id: TASK:tools/simple-operation-plans
type: task
status: accepted
summary: Accept concise operation requests with ordinary tool arguments and harness-owned execution bookkeeping.
owners: [carlo]
progress: done
addresses:
  - REQ:tools/operations#c-plan
  - REQ:tools/operations#c-planner
  - REQ:tools/operations#c-policy
  - REQ:tools/operations#c-evidence
  - REQ:tools/operations#c-verification
labels: [tools, operations, experimental]
---

# Simple operation plans

## Scope

Make a bounded goal and fixed steps with plain tool arguments sufficient for an ordinary operation request. Resolve that request explicitly into the runner's immutable version-one program, with generated step identities, literal argument expressions, deterministic result-presence checks, complete observations and completion evidence. Preserve the detailed version-one input for typed references and explicit assertions. Keep the model-facing declaration and guidance concise; show the small executable form first.

## Acceptance

The small form executes through the real scoped tool pipeline and records the normalized program. Invalid or ambiguous requests fail before effects. Existing detailed plans retain strict parser validation and every execution policy, process-outcome check, resource bound, semantic checkpoint and stop behavior. Default observation includes complete canonical results; an optional explicit pointer list selects complete necessary evidence without truncation. Keyless Session replay and both SDK projections cover the concise entrypoint. Live provider behavior is reported separately.
