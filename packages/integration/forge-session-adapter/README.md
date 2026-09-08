# @deepseek-ai/dsh-forge-session-adapter

This plugin is the DeepSeek Harness implementation of `forge.agent.session/v1`. Forge owns durable work, exact revision selection, Temporal lifecycle, executor allocation, and policy. The adapter accepts that allocated world, injects a verified Forge Spec v0.6 or v0.7 agent render before the first model request, and mounts Forge Intellect as the only model-visible workspace action surface.

## Runtime contract

- `GET /v1/capabilities` reports the protocol, command set, approval semantics, checkpoint support, limitations, and evidence versions.
- Every route requires the deployment-owned token in `X-Forge-Adapter-Token`. The adapter does not accept generic `Authorization`, so a lifecycle reverse proxy can strip ambient credentials without stripping adapter authentication.
- `POST /v1/sessions/{id}/commands` accepts normalized, idempotent Forge commands. Provider-native fields are never required.
- `start` fails closed unless the declared baseline is `forge-spec-v0.6.0` or `forge-spec-v0.7.0`, its SHA-256 digest matches, lint reported zero errors, the render revision equals the session intent revision, the render target equals the durable work id, and the preflight carries `forge.intellect.action/v2` evidence.
- Each agent scope launches `forge-intellect-action-mcp` and exposes exactly `workspace_read`, `workspace_apply`, `workspace_run`, `workspace_reconcile`, and `workspace_watermarks` under the `mcp__forge_intellect__*` namespace.
- Workspace and session ledger identities use the same URL-namespace UUIDv5 derivation as Forge's preflight worker, so preflight and agent actions remain one provenance stream.
- Reads are allowed. Workspace mutations and commands ask through the Harness approval seam; `approve` resolves the pending Forge decision without blocking the Temporal command activity.
- The complete executor policy is immutable for the session. `workspace_apply` requires that exact capability in `tools`; `workspace_run` requires its first executable name in `tools`. A later command cannot widen either list.
- `close` reconciles external changes and records watermarks before disposing the session. Evidence or cleanup failure is a terminal outcome, never a successful close.
- A deployment may set `commandSandbox: landlock`. The adapter then configures the compatible action MCP to clear each `workspace_run` child environment and wrap the exact argv with the shipped Landlock launcher. Runtime roots are read-only; only the exact allocated workspace, a lease-specific temporary directory, `/dev/null`, and the exact credential socket are writable.
- A `forgejo:project:write` scope requires a Forge-owned Unix socket at `<credentialSocketRoot>/<executor_lease_id>/agent.sock` plus its Forge-owned `known_hosts` file. The action MCP receives that `SSH_AUTH_SOCK`, a fixed strict-host-key Git command, and the private temporary-directory variables; private key bytes never cross the Forge session protocol.

The runnable composition is [`examples/forge-adapter/cordis.yml`](../../../examples/forge-adapter/cordis.yml). Its dedicated adapter token, session state, adapter state, Intellect ledger root, graph database, action-MCP executable, and listen port are deployment configuration.

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

- **The executor world is supplied, not created** — Forge must allocate and mount the canonical workspace, credential socket, network, resources, and lifetime. This adapter confines model-requested child file access when the Landlock mode is enabled; it does not create worktrees, credentials, network namespaces, or cgroups.
- **Pause/resume commands are not advertised** — durable process restart uses Harness session resume, but operator pause semantics remain a Forge adapter protocol extension.
- **One approval is pending per session** — shipped compositions use serial tool calls. A concurrent second question fails closed as unavailable.
- **Diff content is retained as evidence** — the protocol returns Intellect artifact and watermark references rather than embedding an unbounded patch.
