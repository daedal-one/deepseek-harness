---
id: TASK:guard/tool-policy
type: task
status: accepted
summary: Replace context-contaminated shell verdicts and delayed approval with independent low-latency authorization evidence.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy#c-plugin
  - REQ:guard/tool-policy#c-fast-path
  - REQ:guard/tool-policy#c-independence
  - REQ:guard/tool-policy#c-effects
  - REQ:guard/tool-policy#c-latency
  - REQ:guard/tool-policy#c-approval
  - REQ:guard/tool-policy#c-durability
  - REQ:guard/tool-policy#c-evidence
labels: [guard, tool-policy, approval, latency]
assignee: carlo
---

# Low-latency tool authorization

## Acceptance

The shipped shell policy resolves common safe reads deterministically, evaluates
bounded user and agent intent independently from command effects, derives the
effective decision in host code, and routes the first genuine ask through the
existing approval service. Durable evidence, focused tests, an assembled
snapshot, and repeated real-route evaluation demonstrate that production-like
read commands avoid false approval while protected operations still fail
closed.
