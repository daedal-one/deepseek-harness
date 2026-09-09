# Agent Note: Forge session child-process and credential boundary

Status: implemented

## Problem

The Forge adapter already gives each agent an exact server-owned worktree, but its Forge Intellect action process inherited a shared container environment and launched `workspace_run` children directly. Container-level hardening therefore did not prevent one session command from reading sibling worktrees or ambient credentials.

## Decision

Forge remains the authority that allocates worktrees and credentials. The adapter accepts the immutable executor lease identifier, derives exactly one Unix socket beneath its configured credential root, and verifies that endpoint is a socket before creating the agent scope. It supplies `SSH_AUTH_SOCK` and a strict `GIT_SSH_COMMAND` that pins the session-scoped known-hosts file to the action MCP; no private key or OpenBao credential crosses the adapter wire.

For each agent scope, the adapter configures the compatible Forge Intellect action MCP to clear the child environment and wrap each `workspace_run` command with the npm-distributed `landlock-run` launcher. The launcher receives read/execute grants for runtime directories and the exact workspace, write grants for the exact workspace, a session-private temporary directory, and the exact credential socket, and no grant for retained Intellect state, sibling executor roots, or the rest of the credential volume. The action MCP remains outside this child sandbox so it can retain evidence and publish watermarks.

This is filesystem confinement. The existing container network and resource limits remain deployment boundaries; this change does not claim per-command network namespaces or cgroups.

## Alternatives considered

**Inject the private deploy key into the command environment or workspace.** Rejected because model-driven processes could read, persist, or echo the key; the broker-owned SSH agent exposes signing capability without exposing key bytes.

**Trust the read-only container and exact worktree without child confinement.** Rejected because the shared adapter process can see every mounted executor worktree and retained state. Container hardening alone does not establish a session-specific filesystem boundary.

**Run an independently networked container for every command.** Rejected for this slice because Forge already owns container-level network and resource policy, while the immediate unclosed boundary is filesystem and environment access by `workspace_run`. A future executor may replace this wrapper with a container or microVM without changing the adapter protocol.

## Consequences

- Missing launcher configuration, malformed lease identity, an escaped workspace, or a missing credential socket fails session startup closed.
- The deploy key remains usable by Git through its SSH agent without making private key bytes readable to the model-driven command.
- The adapter depends on the compatible Forge Intellect command-wrapper CLI and the released Landlock package family; the release image must ship both.
- Commands may read runtime libraries and `/etc`, but cannot read Forge Intellect state or another executor workspace.

## Testing

Adapter tests reject malformed lease identities and missing credential sockets and keep the session policy stable across commands. The Forge Intellect workspace suite executes a real wrapper fixture and proves argv preservation plus environment reconstruction. Linux release validation must additionally require a successful `landlock-run --probe` before the adapter accepts sessions.
