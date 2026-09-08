---
id: REQ:integration/forge-runtime
type: requirement
status: accepted
level: MUST
summary: DeepSeek Harness implements Forge sessions through exact repository intent and accountable workspace actions.
owners: [carlo]
refines: []
related: [IFC:integration/forge-session-adapter]
---

# Forge runtime integration

:::{requirement id="forge-runtime" level="MUST"}
- {#c-protocol} The adapter MUST implement `forge.agent.session/v1` without
  requiring DeepSeek Harness native fields in the Forge command, event, or
  outcome records.
- {#c-intent} A session MUST reject dispatch unless its exact workspace revision
  passes lint for its declared forge-spec v0.6 or v0.7 baseline and its accepted work plus affected durable intent
  are rendered before the first model request.
- {#c-actions} Model-visible workspace reads, mutations, and commands MUST pass
  through `forge-intellect-action-tools/v1`; a missing or incompatible action
  provider MUST stop session startup.
- {#c-evidence} Normalized tool, checkpoint, diff, and outcome events MUST retain
  the Forge causality identifier and the Forge Intellect action, delta,
  artifact, projection, and graph-view identifiers that exist for the event.
- {#c-policy} The adapter MUST receive an already allocated execution world and
  MUST NOT widen the Forge executor policy or select host authority for itself.
- {#c-lifecycle} Cancellation, approvals, durable session checkpoints, adapter
  restart, evidence failure, and cleanup failure MUST remain distinguishable
  and MUST NOT be reported as successful completion.
- {#c-compatibility} The shipped composition MUST pin the Forge session, Forge
  Spec, and Forge Intellect protocol versions and fail closed on an unsupported
  combination.
- {#c-project-workspaces} The Forge Web composition MUST reconcile exactly one
  managed Harness workspace for each Forge-supplied `ProjectId`, slug, title,
  and repository, and MUST select only an already reconciled workspace from a
  Hub deep link; it MUST NOT create an independent Forge project authority.
- {#c-publication} Code publication MUST bind the calling Session to its persisted
  Forge repository, require explicit approval of the selected development commit,
  refuse default branches, force updates, tags, deletions and alternate destinations,
  obey Forgejo branch protection, and verify the resulting remote revision. Credentials MUST remain
  in controlled Git child environments and MUST NOT enter workspace files or model
  results; editable repository Git configuration MUST NOT redirect publication.
  Forge Code model tools MUST NOT read private Harness state, parent process credentials,
  or sibling workspaces through direct paths or filesystem aliases; repository reads
  and searches MUST share the confined command boundary. Code commands and source
  Git preflight MUST deny new network endpoints, including parent-service loopback
  and Unix sockets; trusted approved publication remains a separate transport path.
:::
