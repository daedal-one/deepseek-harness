---
description: "Classify MCP calls using deployment-owned server and tool rules."
kind: "package-reference"
---

# dsh-tool-policy-mcp

## Summary

Classify MCP calls using deployment-owned server and tool rules. The policy can allow known operations and require approval when a call does not match trusted rules. It does not infer trust from model-supplied arguments.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Deterministic `ctx.toolPolicy` provider for an exact reviewed MCP tool surface. Each configured public tool name receives an `allow`, `ask`, or `deny` rule. An optional principal allowlist derives authorization from the child's durable config-owned subagent descriptor, so a root agent or another role cannot claim access through arguments or persona text. Optional root URL arguments accept one URL or an array of URLs; every value must use HTTP(S), avoid non-public literals, and resolve completely to public addresses. Optional forbidden arguments fail closed before an MCP request is sent.

This provider complements `dsh-mcp-client` registration-time tool and argument projection. Projection prevents unreviewed schemas from reaching the model; this provider applies execution-time authorization and thresholded approval through `dsh-tool-policy-enforcer`.

No invariant companion is published because the provider contributes decisions through the tool-policy service.

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

### Dev Note

None.
