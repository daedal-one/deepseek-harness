---
id: REQ:guard/tool-policy
type: requirement
status: accepted
level: MUST
summary: Tool authorization combines independent intent and command-effect evidence with deterministic host policy and low-latency approval routing.
owners: [carlo]
refines: []
categorized_under: []
---

# Tool authorization policy

## Context

Shell authorization must distinguish the exact command's effects from the
broader requested task without trusting the acting model to approve itself.
Common safe reads need deterministic latency, while uncertain or externally
meaningful operations need attributable independent evidence before execution.

:::{requirement id="tool-policy" level="MUST"}
- {#c-plugin} Shell authorization MUST remain an effect-scoped provider of the
  existing tool-policy capability; intent and effect analysis MUST be private
  provider mechanisms, and the agent loop MUST remain unchanged.
- {#c-fast-path} Fixed security decisions, deployment rules, and a conservative
  parsed subset of workspace and temporary-file reads MUST resolve without an
  auxiliary model request.
- {#c-independence} Unmatched commands MUST obtain a bounded user-intent context
  from a model route distinct from the acting agent. The context review MUST see
  only direct user messages and MUST be reusable across calls for the same
  latest message. Command-effect review MUST receive that short context, the
  acting model's stated intent, the command, and working directory, but no raw
  user message. Deployments MAY use the same provider and model for both
  separately dispatched requests.
- {#c-effects} Auxiliary results MUST use bounded, validated effect categories;
  deterministic host policy MUST own the effective allow, ask, or
  deny decision and MUST fail closed on missing, malformed, or conflicting
  evidence.
- {#c-latency} Intent context review MUST start when an enforced session accepts
  a direct user message, share in-flight exact inputs, and remain outside the
  tool-time decision budget. Tool-time review MUST make one primary request and
  use a further independent opinion only when it returns no valid evidence. One
  configured deadline MUST bound the tool-time request and fallback; the Daedal
  policy-reviewed profile MUST target sub-second completion and cap the wait at
  2 seconds.
- {#c-approval} A genuine ask decision MUST enter the existing approval service
  on its first occurrence; approval MUST NOT require a model to repeat an exact
  tool call, and deterministic denials MUST remain unapprovable.
- {#c-durability} Every exact bounded auxiliary request and each provider and
  effective decision MUST be reconstructable from durable session events
  without duplicating secrets or raw tool arguments.
- {#c-evidence} Focused unit, lifecycle, keyless assembled-application, and
  self-skipping real-route evaluation MUST cover safe reads, conflicting
  intent, sensitive and destructive commands, unavailable routes, direct
  approval, and repeated production-like command corpora.
:::
