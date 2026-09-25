# Agent Note: Conversation profiles own initial access; execution placement is observed

Status: implemented

## Problem

A permission label cannot identify where tools execute. Policy review can run on the host or inside a container, and full file access remains limited to the providers mounted by the server. Presenting these as interchangeable environments misrepresents the authority a selector grants.

## Decision

Conversation profiles declare a permission-table key in `access.yml`; absent declarations inherit the server default. The separate file has strict parsing because access failures must not inherit display metadata’s best-effort behavior. The server validates the key before mounting or replacing a composition. Creation captures the policy and default; resumed and forked histories retain their effective permissions. A blank profile change applies the new default, which the user may override before the first turn.

The compact selector shows an execution-location icon beside the policy. Its menu separates location from policy choices and explains the selection’s source. Filesystem and subprocess providers must share an execution identity; only a verified local-container marker earns the container icon. Missing or mixed identities remain unverified. A log-only context event preserves placement and the captured default for saved-session projections.

The first model turn locks the user-facing permission choice. A new session is the supported route to another policy. Known placement is checked on resume; changing permissions never moves files or processes. Transferring a conversation requires a separate destination session and an explicit description of the transferred state. The [sandbox decision](../feature/2026-07-06-sandbox.md) retains confinement and per-call escalation; the [agent-preset decision](2026-08-03-per-session-agent-presets.md) retains composition lifetime.

## Alternatives considered

Inferring isolation from preset names fails for custom labels and policy review in either environment. A shield icon also conflates review with confinement. Observing providers gives a conservative placement label without claiming isolation for arbitrary external adapters.

Replacing providers inside a conversation needs a workspace and process migration protocol. A permission command has neither. Mutable defaults would also rewrite saved sessions after configuration edits.

## Consequences

Profiles require a server supplying their named permission entries. Copies retain access declarations; edits affect future mounts. Older logs without placement evidence remain unverified until observation. The selector cannot change a started session; lower-level policy events and per-call approvals remain owned by their enforcement packages.

Loader tests cover defaults, overrides, blank switches, invalid references, saved permissions, and changed placement. Provider-identity tests cover host, container, external, and mixed execution; UI tests cover the compact selector and disabled choices.
