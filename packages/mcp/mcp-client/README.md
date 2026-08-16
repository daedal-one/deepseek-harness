# @deepseek-ai/dsh-mcp-client

English | [中文](README.zh.md)

MCP client bridge plugin: connects to external [Model Context Protocol](https://modelcontextprotocol.io/) servers and registers their tools on `ctx.tools`, making them available to the model as native tools under server-qualified names (`mcp__<serverName>__<rawName>`).

## Usage

One plugin instance per MCP server in `cordis.yml`:

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    includeTools: [get_issue, create_issue]
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

The model sees `mcp__github__create_issue`, `mcp__web__search`, … — the same server-qualified shape Claude Code and Codex use. HMR hot-swaps: editing the entry triggers disconnect + reconnect without process restart; an unchanged `serverName` reproduces identical tool names.

## Config

| Field | Transport | Required | Description |
|---|---|---|---|
| `transport` | both | yes | `"stdio"` or `"streamable-http"` |
| `serverName` | both | yes | Namespace for this server's model-facing tool names; `[A-Za-z0-9_-]{1,32}`, unique across live instances |
| `command` | stdio | yes | Executable to spawn |
| `args` | stdio | no | Arguments passed to the command |
| `env` | stdio | no | Extra env vars merged on top of scrubbed ambient env |
| `cwd` | stdio | no | Working directory for the child process |
| `url` | http | yes | MCP server URL |
| `headers` | http | no | Extra headers (e.g. auth tokens) |
| `includeTools` | both | no | Exact raw MCP tool names to publish; a missing configured name rejects synchronization |
| `removeArguments` | both | no | Argument names removed from every selected tool schema and request |
| `bindSessionArguments` | both | no | String argument names removed from schemas and populated with the executing Agent session id |
| `urlHostBindings` | both | no | Per-tool source URL arguments whose hostnames populate a hidden provider domain-restriction argument |
| `clientLifetime` | both | no | `plugin` shares one execution client; `agent` creates and disposes an isolated client per live Agent (default `plugin`) |
| `toolCallTimeoutMs` | both | no | Timeout per `callTool` invocation (default 60000) |
| `processGraceMs` | stdio | no | Managed process-tree TERM-to-KILL grace in milliseconds (default 2000) |
| `failOnStartupError` | both | no | Reject plugin activation when initial connection or tool synchronization fails (default `false`) |
| `reconnect.enabled` | both | no | Reconnect automatically after a lost connection (default `true`) |
| `reconnect.initialDelayMs` | both | no | First reconnect delay in ms; doubles per consecutive failed attempt (default 500) |
| `reconnect.maxDelayMs` | both | no | Backoff ceiling in ms; also the uptime after which the attempt budget resets (default 30000) |
| `reconnect.maxAttempts` | both | no | Consecutive failed attempts per outage before giving up for good (default 10) |

## Tool naming

Every MCP tool has two names: the raw MCP name (sent on the wire in `tools/call`) and the public name `mcp__<serverName>__<rawName>` registered on `ctx.tools`. Public names are normalized to the DeepSeek function-name contract (64 chars, `[A-Za-z0-9_-]`); when replacement or truncation changes the name, a deterministic 12-hex-char hash of `(serverName, rawName)` is appended so distinct tools never collapse into one name. Names are pure functions of `(serverName, rawName)` — connection order, re-syncs, and other servers never rename a tool.

- Two servers publishing the same raw name (e.g. `search`) coexist under their namespaces.
- A duplicate `serverName` inside one live composition scope fails the later plugin instance at load. Independent preset scopes may reuse the same namespace without sharing registrations.
- A server listing the same tool name twice is rejected as an invalid tool list.
- A foreign registration squatting on this server's namespace rolls back the whole generation (never a partial set), with a loud error.

## Behavior

- On connect: plugin activation awaits `listTools()` and registers the exact configured `includeTools` subset via `ctx.tools.register()` under public names before the composition starts its first turn. Omission keeps the full server list for compatibility. A configured name absent from discovery rejects synchronization. Initial connection, discovery, or registration failure is always logged; it rejects activation when `failOnStartupError` is true and otherwise activates with no tools.
- Projection removes deployment-owned arguments from schemas before registration. `removeArguments` also omits them on the wire; `bindSessionArguments` injects the executing Agent's durable session id. Every configured projected argument must exist on every selected tool, so a provider schema change fails loud during synchronization.
- A `urlHostBindings` entry derives unique hostnames from one selected tool's string or string-array URL argument and injects them into a target already hidden by `removeArguments`. This lets browser providers receive model-independent domain restrictions for the navigation calls that establish a session.
- Stdio servers resolve and run through `ctx.subprocess`; process-tree termination, credential-shaped ambient environment scrubbing, and teardown quiescence therefore use the harness subprocess implementation. Explicit `env` entries remain deliberate exceptions to the ambient scrub.
- `clientLifetime: agent` keeps the discovery client at plugin scope but routes calls through a lazily connected client owned by the exact live Agent. Agent disposal closes that client, and a cold resume receives a new client.
- Listens for `notifications/tools/list_changed` → re-syncs; a fetch-phase failure keeps the previous generation registered, while a registration conflict rolls back the attempted generation and leaves no tools from that server.
- Tool execute: `client.callTool({ name: rawName, arguments }, { signal })` with timeout + abort support—the public name is never sent to the server.
- Canonical success is `{ content: JsonValue[], structuredContent? }`; complete JSON MCP blocks survive for programmatic callers. A supported advertised `outputSchema` validates `structuredContent`; unsupported schema vocabulary falls back to unconstrained `JsonValue`.
- Native/model rendering keeps the existing text projection: text blocks join with newlines while image, audio, resource, and unsupported blocks become placeholders.
- On disconnect/crash: the supervisor restarts the original server config with exponential backoff (`reconnect.initialDelayMs` doubling up to `reconnect.maxDelayMs`) and re-runs discovery on success — the recovered generation replaces the previous one, so tools neither duplicate nor leak. During the outage the last good generation stays registered; calls against it fail until recovery.
- Reconnection is budgeted per outage: after `reconnect.maxAttempts` consecutive failures the server's tools are unregistered and reconnection stops until an HMR reload or Host restart. A connection that survives past `maxDelayMs` resets the budget, so an occasionally-crashing server recovers indefinitely while a crash-looping one — even with briefly successful connects — still exhausts the cap instead of restarting forever.
- Reconnect states are user-visible in logs: reconnecting (warn, with attempt count and delay), recovered (info), final failure and disabled-loss (error). Disposal cancels any pending reconnect. With `reconnect.enabled: false`, a lost connection keeps tools registered but failing until a reload — the manual-recovery behavior.

## Services consumed

| Service | Usage |
|---|---|
| `ctx.tools` | Register/unregister MCP tools |
| `ctx.subprocess` | Resolve and manage stdio MCP server process trees |

## Model Experience

### Discovered MCP tools

#### What the model sees

After initial discovery succeeds, each selected MCP tool appears as a native tool named `mcp__<serverName>__<rawName>` (or its deterministic normalized form), with the server-provided description and projected input schema. A successful re-sync — including the one after an automatic reconnect — replaces the generation; plugin disposal or an exhausted reconnect budget removes it.

#### Token effect

Data-dependent schema cost is paid on every request while the tools are registered. Re-sync replaces rather than accumulates schemas, and the server-qualified name adds tokens to every tool definition and call.

#### KV Cache effect

Prefix-stable while the discovered tool set and schemas are unchanged. A re-sync that adds, removes, renames, or changes a tool replaces definitions and may invalidate reuse from the first changed schema token; a reconnect that recovers an unchanged list reproduces identical definitions and stays prefix-stable.

### Tool-call history and results

#### What the model sees

The public tool name and JSON arguments remain in assistant history. Text result blocks are joined with newlines into one retained Native text result; image, audio, resource, and unsupported blocks become short placeholders there. Their full JSON blocks and optional structured content remain in the execution-local canonical value, and MCP `isError` rejects the call through the registry's error path.

#### Token effect

Arguments and mapped text are retained until compaction. Binary and resource payloads are discarded rather than added to context.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Tools are the only bridged MCP capability** — Resources and Prompts have no harness consumer and are deferred.
- **Startup timeout is inherited from the MCP SDK** — DSH does not yet expose a connection/discovery timeout. Each initialize or paginated `tools/list` request uses the SDK's 60-second default, so an unresponsive server or cursor chain can delay both activation and teardown while the initial synchronization settles.
- **Projection is uniform across selected tools** — each configured removed or session-bound argument must exist in every selected schema. Providers needing different controls per tool require separate server instances or a future per-tool projection.
- **URL-host binding covers configured navigation calls** — it does not inspect provider-internal redirects or scripts. Providers must enforce the injected domain restriction for the session; policy validation alone cannot pin their later sockets to checked DNS records.
- **Reconnect triggers on transport close** — a crashed stdio child fires it; Streamable HTTP failures surface per request and through the SDK transport's own SSE-stream recovery, so an unreachable HTTP server is retried per call rather than respawned by the supervisor.
- **Native non-text rendering is lossy** — image, audio, and resource payloads become placeholders in model context even though the execution-local canonical value preserves their JSON blocks. Richer Native multimedia projection is deferred.
- **Unsupported MCP output schemas are not enforced** — `structuredContent` falls back to `JsonValue` when the advertised schema uses vocabulary outside the harness subset.
