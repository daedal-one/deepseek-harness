# dsh-tool-policy-shell

This effect-scoped provider interprets explicitly mapped shell tools through the existing `ctx.toolPolicy` service. It combines fixed security checks, ordered deployment rules, a conservative parsed read-only set, and bounded independent intent and command-effect review. Bash and PowerShell are supported by configuration; neither tool name nor argument name is built in.

## Configuration and behavior

`mappings` names each supported tool plus its command and optional acting-model intent argument. `intent` selects user-context preparation; `primary` selects tool-time command review; `secondary` must use a different effect route. Intent and primary may use the same `ctx.llm` provider/model route. Each route may set a provider-neutral `reasoningEffort`, which passes unchanged to `ctx.llm`; omission preserves that model route's default reasoning behavior. `intentContextTimeoutMs` bounds preparation outside tool execution. `decisionTimeoutMs` bounds primary review and secondary fallback together. Every input/output bound, summary cap, effect count, and ordered command rule is required configuration. At runtime, a route matching the acting model is excluded; missing independent evidence fails closed.

Host-root destruction primitives and protected credential paths are denied before rules or model calls. Unconditional Git force pushes, remote deletes, and mirrors ask; `--force-with-lease` and `--force-if-includes` remain eligible for ordinary evaluation. Rules use glob-like whole-command matching, the last match wins, and an allow rule cannot admit a command containing shell metacharacters.

The parsed fast path accepts literal read pipelines and command lists whose stages write only to stdout and whose resolved files stay in the workspace or platform temporary directory. It recognizes a `cd` back to the authoritative workspace, literal `echo`, and stderr discard to `/dev/null`; other directory changes, substitution, redirection, execution syntax, write flags, unresolved paths, and symlink escapes leave the fast path.

For an enforced session, `prewarm()` sends bounded ordered direct-user messages to the intent route. Concurrent preparation for the same latest message shares one request, and only a validated result remains reusable; invalid or unavailable preparation fails closed for its current waiter and is discarded so a later evaluation can retry. The validated result is a short summary plus allowed and explicitly forbidden effects. Tool-time review receives that context, the bounded acting-model intent, exact command, and working directory, but no raw user message. It returns only alignment and closed direct effects through one compact line. Validation accepts the compact separators emitted by the configured route and an exact closed JSON object, while extra prose, extra fields, and unknown effects remain invalid. Host code derives risk and the verdict. Effect review resolves explicit path operands against the working directory and excludes ambient runtime access, implicit tool configuration, descriptor plumbing, and `/dev/null`; only an explicitly named or command-derived path outside the working directory produces an outside-workspace effect. Reading filesystem state outside the working directory requires aligned, explicit `outside-workspace-read` intent; `host-read` is limited to non-file operating-system or hardware information, and credential access remains separately approval-requiring. A secondary effect route runs only within the remaining decision time when the primary route does not return valid effect evidence; it never overrides a validated sensitive effect. Invalid, unavailable, failed, expired, conflicting, or out-of-list evidence becomes `ask`; caller cancellation remains cancellation.

## Security behavior

Diagnostics retain only the bounded sanitized intent context and closed effects. Raw user text, acting-model intent, and command arguments remain in their existing `user/message` and `tool/call` events. Classifier-request events record routes, prompts, selectors, bounds, and the referenced intent-context event so each request is reconstructible without duplicating raw input.

## Model Experience

### Conditional authorization feedback

#### What the model sees

This provider adds no main prompt. The enforcement consumer renders denial or approval feedback from its `tools/pre-execute` verdict.

#### Token effect

One validated user-context preparation is shared by every call under the latest direct user message and normally completes while the acting agent works; failed preparation may be retried by a later call. Known fixed, rule, and parsed read-only cases spend no tool-time classifier tokens. Other calls spend one primary request; missing or invalid primary effect evidence may spend one further request within the original decision deadline. Wall time never receives a fresh timeout from fallback.

#### KV Cache effect

Classifier requests use a fixed system prefix and stable line order, improving auxiliary cache reuse. They do not modify the main conversation prefix.

## Known Limitations and Deferred Work

- The fast path intentionally recognizes only a small shell grammar; commands outside it use independent model evidence.
- A bounded command that exceeds its configured limit asks instead of sending a truncated command to a classifier.
