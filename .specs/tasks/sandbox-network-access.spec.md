---
id: TASK:sandbox/network-access
type: task
status: accepted
summary: Repair sandboxed Web access using environment-owned grants, multi-repository workspaces, and dynamic user-approved repository attachment.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/isolated-execution-world#c-isolation
  - REQ:sandbox/isolated-execution-world#c-secrets
  - REQ:sandbox/conversation-git-workspace#c-agent
  - REQ:sandbox/environment-access#c-ownership
  - REQ:sandbox/environment-access#c-grants
  - REQ:sandbox/environment-access#c-request
  - REQ:sandbox/environment-access#c-activation
  - REQ:sandbox/environment-access#c-repositories
  - REQ:sandbox/environment-access#c-credentials
  - REQ:sandbox/environment-access#c-coordination
  - REQ:sandbox/environment-access#c-evidence
labels: [sandbox, network, git, deployment]
assignee: carlo
---

# Sandbox network access

The server Web composition must attach chat sessions to multi-repository workspaces within an independently owned Environment. An explicit outbound network setting permits HTTPS pages and repository remotes while preserving private namespaces, read-only image roots, resource controls, and exclusion of host files and signing keys. Offline remains the default for existing compositions. The Environment owns grants and credential issuance; a chat session is not the authority owner.

Deployment configuration may seed explicit grants and limit requestable capabilities. The `request_repo_access` tool requests additional repository read/fetch or push authority through a concrete user approval showing the affected environment and lifetime. Only committed grants authorize broker-issued repository- and operation-scoped credentials. The broker does not persist credentials in workspace files, checkpoints, session events, diagnostics, or the owner controller environment. Container-authored Git configuration cannot select another host credential request. Public remotes need no credential helper. Automatic host branch return never publishes remotely.

Deployment acceptance requires independent Environment and Workspace identities, durable Session attachments, and environment-owned grants. Separate writable checkouts may share an environment; shared mutable checkouts and cross-workspace services require additional coordination before they can be enabled.

Validate offline and outbound modes, private namespaces and denied host-loopback access, source-path mapping, HTTPS fetching, authenticated read access to the selected private remote, credential scoping and expiry, recovery, and preservation of source working files. Qualify the assembled Web profile before activation and preserve companion integration. Do not perform a remote push as a validation step.

## Repository access tool

`request_repo_access` accepts a canonical repository identity, `fetch` or `push` access, and a task-related reason. `push` includes fetch. The executor derives Environment and Workspace identities from the initiating Session; the model cannot choose another environment through tool arguments. The approval states the repository, requested operations, environment, other sessions affected by its scope, and lifetime. A policy-review result or a repository document is not user authorization.

Approval commits a versioned environment grant. Repository attachment then allocates or reuses a manifest entry at a stable path, without replacing another checkout or changing host working files. The result distinguishes grant approval from checkout readiness and includes the execution path only once attachment succeeds. A failed attachment leaves an attributable retryable outcome rather than claiming the repository is ready or erasing the user's approved grant. Existing sufficient grants are reused; fetch-to-push escalation always requests a new user decision.

The grant store, workspace manifest, and Session attachment are separate durable records. Credentials are issued against the latest grant revision at execution time. Session completion does not delete environment grants or shared services. Revocation records immediate denial of new issuance separately from the effective end of already-issued credentials and operations; completed remote effects cannot be rolled back by revocation.

The managed container engine must remain available until workspace supervisors have completed checkpointing and disposed their child containers. Concurrent supervisor and runtime teardown must join one shutdown operation. An unacknowledged shutdown retains its RAM ownership receipt and recovery data rather than marking the workspace clean.

When remote attachment is enabled, any canonical credential-free HTTPS Git remote may be requested, including a repository with no registered host checkout. User approval precedes all cloning. The clone runs inside an authorized sandbox process; only bounded, verified Git bundle data enters a new environment-owned host repository for recovery and immutable result return. Model arguments never select its host pathname or credential helper. Deployment-owned credential issuers are selected by exact HTTPS origin; an unconfigured provider remains anonymously accessible and cannot inherit another provider's credentials. Failure preserves existing checkouts and the approved grant for retry. Evidence must include approval, denial, cancellation, a remote absent from the catalog, reuse across sessions, and restart.

The CLI resolves `DSH_SHUTDOWN_TIMEOUT_MS` from its inherited process environment before profile side effects. The value is a positive bounded integer in milliseconds; omission keeps the five-second default. Operators must set a grace that accommodates bounded workspace checkpoint and container disposal, with their service-manager stop deadline longer than the CLI grace. A second termination signal remains an immediate exit request.

Controller commands with empty input must launch with stdin detached and must not write to the Engine stream. Short-lived executable probes must preserve their exit status and output without shutting down environment workspaces. Validate concurrent missing-executable probes and subsequent workspace selection through the assembled Web profile.
