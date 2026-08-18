---
id: TASK:ui/llm-output-rate
type: task
status: accepted
summary: Replace chunk-drain throughput with end-to-end LLM output rate in Web conversation metrics.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/llm-output-rate#c-measurement
  - REQ:ui/llm-output-rate#c-scope
  - REQ:ui/llm-output-rate#c-degradation
labels: [web, conversation, metrics, bug-fix]
assignee: carlo
---

# Honest LLM output rate

## Acceptance

The stats strip, settled turn footer, and Trajectory timing inspector use full
request wall time for token rate, including providers whose chunks arrive in a
near-instant burst. The whole-session projection, no-unit window fallback,
connection fixture, tests, package documentation, and decision record share
the same measurement.
