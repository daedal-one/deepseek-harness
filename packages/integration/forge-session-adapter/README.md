# @deepseek-ai/dsh-forge-session-adapter

This plugin is the DeepSeek Harness implementation of `forge.agent.session/v1`. Forge owns durable work, exact revision selection, Temporal lifecycle, executor allocation, and policy. The adapter accepts that allocated world, injects a verified Forge Spec v0.6 agent render before the first model request, and mounts Forge Intellect as the only model-visible workspace action surface.

## Runtime contract

- `GET /v1/capabilities` reports the protocol, command set, approval semantics, checkpoint support, limitations, and evidence versions.
- `POST /v1/sessions/{id}/commands` accepts normalized, idempotent Forge commands. Provider-native fields are never required.
- `start` fails closed unless the render is `forge-spec-v0.6.0`, its SHA-256 digest matches, lint reported zero errors, the render revision equals the session intent revision, the render target equals the durable work id, and the preflight carries `forge.intellect.action/v2` evidence.
- Each agent scope launches `forge-intellect-action-mcp` and exposes exactly `workspace_read`, `workspace_apply`, `workspace_run`, `workspace_reconcile`, and `workspace_watermarks` under the `mcp__forge_intellect__*` namespace.
- Workspace and session ledger identities use the same URL-namespace UUIDv5 derivation as Forge's preflight worker, so preflight and agent actions remain one provenance stream.
- Reads are allowed. Workspace mutations and commands ask through the Harness approval seam; `approve` resolves the pending Forge decision without blocking the Temporal command activity.
- The complete executor policy is immutable for the session. `workspace_apply` requires that exact capability in `tools`; `workspace_run` requires its first executable name in `tools`. A later command cannot widen either list.
- `close` reconciles external changes and records watermarks before disposing the session. Evidence or cleanup failure is a terminal outcome, never a successful close.

The runnable composition is [`examples/forge-adapter/cordis.yml`](../../../examples/forge-adapter/cordis.yml). Its bearer token, session state, adapter state, Intellect ledger root, graph database, action-MCP executable, and listen port are deployment configuration.

## Model Experience

### Durable Forge intent

#### What the model sees

Before any user prompt can drive a model request, the session receives the exact Forge Spec agent render, durable work id, workspace revision, target, and Forge Intellect preflight action id as plugin-sourced context.

#### Token effect

The complete accepted render is paid once in the retained session context and remains until compaction. Forge controls render depth and therefore its size.

#### KV Cache effect

Stable for a fixed work item and revision. A different accepted intent revision changes the prefix deliberately.

### Forge Intellect action tools

#### What the model sees

Exactly five native tools named `mcp__forge_intellect__workspace_*`. Their results include the action protocol, action identifiers, artifact or delta references, publications, and workspace watermarks.

#### Token effect

The five schemas are present on every request. Tool arguments and rendered result text remain in conversation history until compaction.

#### KV Cache effect

The roster is fixed and prefix-stable for the session. Action results are append-only.

## Known Limitations and Deferred Work

- **Executor isolation is supplied, not created** — Forge must allocate and mount a canonical absolute workspace with bounded network, credentials, tools, and lifetime. Forge Intellect is an accountability gateway, not a sandbox.
- **Pause/resume commands are not advertised** — durable process restart uses Harness session resume, but operator pause semantics remain a Forge adapter protocol extension.
- **One approval is pending per session** — shipped compositions use serial tool calls. A concurrent second question fails closed as unavailable.
- **Diff content is retained as evidence** — the protocol returns Intellect artifact and watermark references rather than embedding an unbounded patch.
