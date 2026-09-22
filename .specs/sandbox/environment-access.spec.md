---
id: REQ:sandbox/environment-access
type: requirement
status: accepted
level: MUST
summary: Own sandbox capabilities at the environment tier and attach multi-repository workspaces and sessions through explicit grants.
owners: [carlo]
refines: []
categorized_under: []
---

# Environment access

An Environment owns its execution resources, network policy, service lifetime, recovery coordination, and capability grants. A Workspace owns a manifest of one or more repository checkouts, their starting revisions, and independent Git return transactions. A Session attaches agent execution to a workspace in an environment. These identities and lifetimes are separate even when a deployment initially allocates one of each.

Repository grants govern managed attachment and credential-backed operations. General outbound web access also permits unauthenticated reads of public repository content; repository grants must not be presented as a network destination filter. Fetch authority permits obtaining repository data, while push authority permits credential-backed remote writes. Writable sandbox files and host-checkout access are separate permissions.

:::{requirement id="environment-access" level="MUST"}
- {#c-ownership} Environment and Workspace identities MUST be stable branded identifiers independent of Session identifiers. Session cancellation MUST stop only its owned operations and release its attachment; it MUST NOT destroy shared environment services, another session's checkout, or acknowledged recovery data.
- {#c-grants} Durable environment grants MUST name the exact repository identity, allowed remote operations, approving user action, revision, and lifetime. Read/fetch and push authority MUST be distinct. Session-local permission settings MUST NOT widen an environment grant. A deployment MAY narrow which capabilities can be requested, but a policy model MUST NOT manufacture user consent.
- {#c-request} A model-facing `request_repo_access` tool MUST identify a repository and requested access, explain why it is needed, and present the affected environment and grant lifetime to the user. New or broader authority MUST require an explicit authenticated user decision. Rejection, cancellation before the grant commit, ambiguous answers, and unavailable interaction MUST leave grants unchanged. An identical sufficient active grant MAY be reused without another prompt.
- {#c-activation} An approved grant MUST be persisted before use and become available to subsequent operations in attached sessions without restarting Web. All affected sessions MUST receive a logged capability change before their next model request. Grant revision checks MUST prevent an earlier approval or credential response from overwriting newer authority. Revocation MUST stop new credential issuance and define how running processes and issued credentials reach an effective revocation boundary.
- {#c-repositories} A workspace MUST support multiple repositories at distinct stable execution paths. Attaching a repository MUST preserve existing checkouts and record its source, remote, branch, and starting revision, with authority resolved from the current environment grant. Repository access MUST NOT imply access to arbitrary host paths, unrelated remotes, host signing keys, or the container engine. Authority to fetch from a repository MUST NOT imply permission to push or to mount its host checkout.
- {#c-credentials} An environment-owned broker MUST issue only repository- and operation-scoped credentials from the current grant. Credentials MUST NOT be copied into workspace manifests or checkpoints. The environment identity, current grant revision, and repository identity MUST be checked when issuing authority. A session or repository file MUST NOT select an arbitrary host credential command.
- {#c-coordination} Shared services and shared files MUST be distinct choices. Shared mutable checkouts require coordinated writer admission and finalization; automatic residual commits MUST NOT sweep another active session's changes. Environment checkpoint and restore operations MUST coordinate all affected workspaces and services. Cross-repository Git return MUST record successful components and retry only failed components; it MUST NOT claim an atomic multi-repository transaction.
- {#c-evidence} Acceptance MUST exercise two repositories in one workspace, two sessions in one environment, explicit grant and rejection, read-to-push escalation, dynamic attachment without restart, credential scoping and revocation, session cancellation, independent Git return failures, and restart recovery. Required evidence includes the real approval UI, durable records, model-visible snapshots, both SDK projections, and actual sandbox network and repository operations.
:::
