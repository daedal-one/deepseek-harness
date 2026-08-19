---
id: TASK:guard/daedal-policy-reviewed-runtime
type: task
status: accepted
summary: Deploy and verify Daedal's policy-reviewed permission mode with an available independent intent classifier.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy#c-latency
  - REQ:guard/tool-policy#c-durability
  - REQ:guard/tool-policy#c-evidence
  - REQ:guard/tool-policy-permission-mode#c-daedal
  - REQ:guard/tool-policy-permission-mode#c-existing-modes
  - REQ:guard/tool-policy-permission-mode#c-evidence
labels: [guard, tool-policy, permissions, daedal, bug-fix]
assignee: carlo
---

# Daedal policy-reviewed runtime

## Acceptance

The installed Daedal Web and headless profiles match the version-controlled host
patch, expose the policy-reviewed preset in its declared order, and restrict the
tool-policy enforcer to `danger-full-access` with interactive approval. The intent
classifier uses `google/gemini-3.5-flash-lite` with minimal reasoning, which the
effective OpenRouter route serves even when user settings narrow its model catalog.
Repeated real Web calls prove that Workspace Write bypasses auxiliary policy, Policy
reviewed obtains valid independent intent and effect evidence, aligned explicit
`outside-workspace-read` intent permits only that matching effect, and Full access
bypasses auxiliary policy.
