# Agent Note: Model-backed tool policy with delayed approval

Status: implemented

English | [中文](2026-08-16-model-backed-tool-policy.zh.md)

## Problem

Tool authorization needs deployment rules without trusting the acting model to approve itself or weakening the existing approval audit. Shell calls also need independent model judgment without provider-specific HTTP; a single classifier denial can be a false positive, while classifier failure must never become permission. Reviewed MCP calls need execution-time principal and argument checks because projecting a limited tool schema is not authorization.

## Decision

The capability uses a Service Definition, two Service Providers, and a Consumer. `dsh-tool-policy` owns an effect-scoped named provider registry and evaluates the configured providers or every registered provider. Overlapping supported verdicts combine conservatively as deny over ask over allow. `dsh-tool-policy-shell` maps configured tool and argument names onto shell intent, applies fixed hard-deny and ask checks before ordered last-match rules, admits a small deterministic read-only set, then sends bounded auxiliary requests through `ctx.llm`. `dsh-tool-policy-mcp` applies exact public-tool rules, trusted subagent principals, forbidden root arguments, and public HTTP(S) URL checks to reviewed MCP calls. `dsh-tool-policy-enforcer` converts the canonical verdict at `tools/pre-execute` and leaves human decisions to `ctx.approval`.

The primary classifier runs at temperature zero with strict JSON framing. Its exact bounded request is durable before dispatch. A primary denial receives an independent configured secondary opinion; only a secondary allow below risk 50 can override when neither opinion carries sensitive or destructive categories. Invalid output, timeout, unavailable routing, or provider failure becomes ask. Caller cancellation remains cancellation.

Ask uses process-local state keyed by session, durable turn, tool name, and canonical exact arguments. The first identical request is denied with exact-retry guidance. Reaching the configured threshold spends the one-shot opportunity before returning ask, so approval, rejection, and cancellation cannot make it reusable in the same turn. Durable decisions omit raw arguments because `tool/call` already owns them.

MCP policy derives a child principal from the durable config-owned subagent descriptor rather than model arguments or persona text. URL checks reject non-HTTP(S) schemes, non-public literals, and any hostname whose complete current DNS answer set contains a non-public address. The separately implemented MCP or browser connection remains responsible for provider-native network restrictions because DNS validation cannot pin that later socket.

## Alternatives considered

**Modify `dsh-tool-bash`.** Rejected because authorization must cover any explicitly mapped shell tool, including PowerShell, and belongs at the executor's enforcement event rather than one model-facing tool implementation.

**Expose a model-facing permission tool.** Rejected because the acting model cannot be the authority that grants its own next operation, and a prompt-only protocol has bypassing callers.

**Call classifier providers over direct HTTP.** Rejected because it duplicates credentials, routing, cancellation, adapter normalization, and provider configuration already owned by `ctx.llm`.

**Change the agent loop.** Rejected because `tools/pre-execute` is the documented operation point that can prevent every registered tool body from running.

**Treat MCP tool projection as authorization.** Rejected because hiding unreviewed schemas does not authorize the remaining calls, bind them to a trusted subagent principal, or validate security-sensitive arguments at execution time.

## Consequences

Known destructive and credential operations fail without model latency, deployment rules remain configurable, uncertain actions fail closed to the existing audited approval path, and classifier provider swaps require no policy rewrite. Reviewed MCP tools share the same verdict and approval pipeline without trusting model-asserted roles. Nontrivial unmatched shell calls add one auxiliary request, while a primary denial adds a second. Delayed opportunities do not survive process restart; durable decision and approval events do. MCP URL checks reduce direct private-network access but retain a DNS rebinding interval before the provider opens its connection.
