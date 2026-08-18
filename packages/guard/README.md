# guard/ — loop-hygiene guard family

English | [中文](README.zh.md)

Behavioral guard plugins watch the agent loop for unproductive patterns and enforce per-call budgets. A guard is a self-contained consumer of core services and extension points, not a swappable capability.

| Package | Role | ctx key |
|---|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Advisory reminders for repeated tool calls | listens on tool and agent events |
| [`timeout-policy/`](timeout-policy/README.md) | Arms per-call tool deadlines as deployment policy | registers a `tools/execute` listener |
| [`tool-policy/`](tool-policy/README.md) | Defines durable tool-policy classification and decisions | `ctx.toolPolicy` |
| [`tool-policy-shell/`](tool-policy-shell/README.md) | Combines deterministic shell rules with independent intent and effect evidence | registers on `ctx.toolPolicy` |
| [`tool-policy-mcp/`](tool-policy-mcp/README.md) | Authorizes an exact MCP surface and rejects unsafe URL or argument values | registers on `ctx.toolPolicy` |
| [`tool-policy-enforcer/`](tool-policy-enforcer/README.md) | Enforces configured tool policy before execution | registers a `tools/execute` listener |
| [`english-output-guard/`](english-output-guard/README.md) | Rewrites targeted non-English model output through an audited translator | wraps `ctx.llm` streams |

Reminders travel as `additionalContexts` on the `tools/post-execute` decision and are appended as logged plugin-sourced `user/message` events ([tools](../../docs/subsystems/tools.md)); the timeout split across `dsh-timeout`, capability termination, and this policy layer is recorded in the [timeout-library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md).
