# Agent Note: Model-backed tool-policy capability

Status: implemented

## Problem

Tool authorization needs deployment rules without trusting the acting model to approve itself or weakening the existing approval audit. Shell calls also need independent model judgment without provider-specific HTTP; a single classifier denial can be a false positive, while classifier failure must never become permission. Reviewed MCP calls need execution-time principal and argument checks because projecting a limited tool schema is not authorization.

## Decision

The capability uses a Service Definition, two Service Providers, and a Consumer. `dsh-tool-policy` owns an effect-scoped named provider registry and evaluates the configured providers or every registered provider. Overlapping supported verdicts combine conservatively as deny over ask over allow. `dsh-tool-policy-shell` maps configured tool and argument names onto shell execution, applies fixed checks and ordered rules, then obtains bounded auxiliary evidence through `ctx.llm`. `dsh-tool-policy-mcp` applies exact public-tool rules, trusted subagent principals, forbidden root arguments, and public HTTP(S) URL checks to reviewed MCP calls. `dsh-tool-policy-enforcer` converts the canonical verdict at `tools/pre-execute` and leaves human decisions to `ctx.approval`.

Deployments may restrict enforcer activation to durable sandbox and approval values. The [Daedal permission-mode decision](2026-08-18-daedal-tool-policy-permission-mode.md) owns that activation condition and its product preset.

The shell evidence mechanism is owned by the [independent tool-policy evidence decision](../bug-fix/2026-08-18-independent-tool-policy-evidence.md), and escalation timing by the [deferred-approval decision](2026-08-24-deferred-tool-policy-approval.md). Intent and command effects use separate concurrent model routes, and each route may pass an explicit provider-neutral reasoning effort through `ctx.llm`. Classifier-request events retain that effort with reconstruction selectors instead of duplicated raw inputs. Classifier output accepts either bare JSON or one exact whole-response `json` Markdown fence before closed-schema validation; prose or malformed framing remains invalid. Closed effects feed deterministic host policy, and consecutive identical asks reach `ctx.approval` at the configured threshold. Invalid output, timeout, unavailable routing, or provider failure remains fail-closed. Caller cancellation remains cancellation. Daedal uses minimal reasoning for its Gemini 3.5 Flash Lite intent reviewer because that endpoint requires reasoning and authorization latency is user-visible.

MCP policy derives a child principal from the durable config-owned subagent descriptor rather than model arguments or persona text. URL checks reject non-HTTP(S) schemes, non-public literals, and any hostname whose complete current DNS answer set contains a non-public address. The separately implemented MCP or browser connection remains responsible for provider-native network restrictions because DNS validation cannot pin that later socket.

## Alternatives considered

**Modify `dsh-tool-bash`.** Rejected because authorization must cover any explicitly mapped shell tool, including PowerShell, and belongs at the executor's enforcement event rather than one model-facing tool implementation.

**Expose a model-facing permission tool.** Rejected because the acting model cannot be the authority that grants its own next operation, and a prompt-only protocol has bypassing callers.

**Call classifier providers over direct HTTP.** Rejected because it duplicates credentials, routing, cancellation, adapter normalization, and provider configuration already owned by `ctx.llm`.

**Change the agent loop.** Rejected because `tools/pre-execute` is the documented operation point that can prevent every registered tool body from running.

**Treat MCP tool projection as authorization.** Rejected because hiding unreviewed schemas does not authorize the remaining calls, bind them to a trusted subagent principal, or validate security-sensitive arguments at execution time.

## Consequences

Known destructive and credential operations fail without model latency, deployment rules remain configurable, uncertain actions fail closed to bounded agent feedback before the existing audited approval path, and reviewer provider swaps require no policy rewrite. Reviewed MCP tools share the same verdict and approval pipeline without trusting model-asserted roles. The shell provider normally runs two auxiliary requests concurrently and adds a secondary effect request only for unresolved evidence; parsed read-only commands use none. Per-route reasoning lets a latency-sensitive reviewer use the least provider-supported effort, while each deployment remains responsible for selecting an effort its exact model accepts. Durable decision, result, and approval events preserve escalation position across process restart without process-local retry state. MCP URL checks reduce direct private-network access but retain a DNS rebinding interval before the provider opens its connection.
