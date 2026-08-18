# dsh-tool-policy-mcp

English | [中文](README.zh.md)

Deterministic `ctx.toolPolicy` provider for an exact reviewed MCP tool surface. Each configured public tool name receives an `allow`, `ask`, or `deny` rule. An optional principal allowlist derives authorization from the child's durable config-owned subagent descriptor, so a root agent or another role cannot claim access through arguments or persona text. Optional root URL arguments accept one URL or an array of URLs; every value must use HTTP(S), avoid non-public literals, and resolve completely to public addresses. Optional forbidden arguments fail closed before an MCP request is sent.

This provider complements `dsh-mcp-client` registration-time tool and argument projection. Projection prevents unreviewed schemas from reaching the model; this provider applies execution-time authorization and direct approval through `dsh-tool-policy-enforcer`.

## Model Experience

### Conditional MCP authorization feedback

#### What the model sees

This provider adds no prompt or tool schema. `dsh-tool-policy-enforcer` renders denial or opens approval when a matching MCP call does not resolve to `allow`.

#### Token effect

Allowed and unsupported calls add no model-visible tokens. Denied or deferred calls add one bounded tool result to the next request.

#### KV Cache effect

Policy feedback is append-only after the reusable conversation prefix. Changes to rules or DNS answers affect later verdicts without replacing earlier request tokens.

## Known Limitations and Deferred Work

- DNS validation precedes a separately implemented MCP/browser connection and cannot pin that later socket to the checked records. Stateful local browser providers should also use `clientLifetime: agent` and provider-native domain restrictions.
- Rules name public `mcp__...` tool names because those are the stable identities observed at `tools/pre-execute`.
