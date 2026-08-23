---
id: TASK:guard/daedal-policy-reviewed-latency
type: task
status: accepted
summary: Keep Daedal policy-reviewed decisions below one second and use Gemini Flash Lite for both blinded primary reviews.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:guard/tool-policy#c-fast-path
  - REQ:guard/tool-policy#c-independence
  - REQ:guard/tool-policy#c-latency
  - REQ:guard/tool-policy#c-durability
  - REQ:guard/tool-policy#c-evidence
  - REQ:guard/tool-policy-permission-mode#c-daedal
labels: [guard, tool-policy, permissions, daedal, latency, bug-fix]
assignee: carlo
---

# Daedal policy-reviewed latency

## Acceptance

Daedal prewarms bounded user-intent context with `google/gemini-3.5-flash-lite` and minimal reasoning while the acting agent works, then gives that short context and the acting model's stated intent to a compact command-effect request on the same model. It retains a distinct secondary effect route and caps the tool-time review at 2 seconds while targeting sub-second completion. Only validated intent context remains reusable; unavailable or malformed preparation is discarded so a later evaluation can retry instead of repeating stale failure evidence. The intent protocol assigns each evidence field to an explicit newline and defines the empty-effects prefix so real continuation and status contexts remain parsable. The auxiliary protocols request only evidence fields used by host policy. Effect review resolves explicit command paths against the supplied working directory, excludes ambient runtime and descriptor access, and reports outside-workspace effects only for explicitly named or command-derived paths outside that directory. Common compound read-only inspection commands resolve deterministically without provider I/O. Focused lifecycle tests and repeated real-route and Web measurements record decision latency, distinguish workspace Git inspection from genuine outside-workspace reads, and prove that deadline expiry asks once without the prior 30-second wait.
