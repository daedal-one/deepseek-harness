# Agent Note: Reviewed MCP registration and per-Agent lifetime

Status: implemented

English | [中文](2026-08-16-reviewed-mcp-registration-and-lifetime.zh.md)

## Problem

An MCP server's discovered tool list was registered wholesale. A child tool filter could hide tools from that child, but the parent Agent still saw every server capability, including mutations outside the intended role. Provider annotations were descriptive only, model-controlled session or page identifiers could cross Agent sessions, and stdio servers bypassed the harness subprocess lifecycle.

## Decision

`dsh-mcp-client` projects a reviewed raw-tool allowlist at registration. Every configured name must appear in discovery. Deployment-owned arguments can be removed, bound to the executing Agent's durable session id, or populated from validated source-URL hostnames before the request reaches the provider. Projection mismatches fail synchronization instead of publishing a partial or broader surface.

MCP policy is a Tool Policy provider keyed by exact public tool names. It denies untrusted principals, private or local URL targets, forbidden provider arguments, and malformed URLs before execution; reviewed external mutations use the ordinary delayed approval path. The trusted principal comes from the durable subagent descriptor, never a tool argument or persona.

Stateful browser providers use `clientLifetime: agent`. Discovery remains at plugin scope, while execution clients are created lazily for one live Agent and closed with that Agent. Stdio launch runs through `ctx.subprocess`, so process-tree termination, environment handling, and teardown use the same lifecycle as other harness subprocesses.

## Alternatives considered

**Rely only on subagent tool filters.** Rejected because the root Agent still receives the complete MCP registration and filters do not validate model-controlled arguments.

**Share one browser client and namespace ids in prompts.** Rejected because prompts do not enforce ownership and a guessed or retained provider id could still cross sessions.

**Spawn stdio through the SDK transport directly.** Rejected because the process would bypass the harness process-tree and environment lifecycle.

## Consequences

The registered schema is the reviewed capability surface, not merely a child prompt convention. Parent Agents cannot call omitted provider tools, and named roles cannot borrow another role's authority by changing text. Per-Agent clients prevent provider state from being shared accidentally across concurrent sessions.

HTTP redirect and DNS validation remain the provider's responsibility after a request crosses the MCP process boundary. OAuth negotiation, startup-timeout configuration, and lossless native non-text projection remain unsupported; presets must not promise those behaviors.
