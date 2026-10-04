# Agent Note: Prefix-bound host Session admission

Status: implemented

## Problem

A restored host history can name the same logical agent preset that ordinary container conversations use. Histories without a recorded execution environment can silently resume in the destination's container composition. Replacing that preset globally instead changes unrelated conversations. Editing a started history's preset or permissions would misrepresent the composition that produced its requests and violate released-generation preservation.

## Decision

[`AgentPresets.sessionAdmissions`](../../../../packages/preset/agent-presets/README.md) is a finite operator-controlled map. Each entry binds the exact restored header, inherited-event cut, and a SHA-256 fingerprint of an immutable logical event prefix to a system-trusted host composition. The fingerprint covers complete envelopes using a versioned, domain-separated canonical JSON encoding. Later ordinary log suffixes do not invalidate the original admission.

Logical and actual composition identities remain separate. The Session keeps its original logical preset; standing caches distinguish ordinary and admitted variants, actual targets, paths, and generations. Admission validates before cache lookup and Agent publication. Joined scopes retain admission provenance: preparation, final publication, and command execution reject a lost admitted generation instead of falling back to inherited providers. Profile access defaults remain owned by the logical preset rather than the execution wrapper. Admitted bindings cannot recompose into another profile through the ordinary selection path.

A wrapper changes execution providers only. Identity validation and host-world checks do not prove equivalent model-facing composition; operator qualification must compare the original logical composition with the wrapper's generated requests. Existing events continue to record model-visible inputs and actual permissions. Admission adds neither a Session event nor a remote composition setter.

Execution discovery follows the shell provider actually bound to active shell-consuming Loader rows. Conflicting consumer bindings fail; a composition without consumers must have one unambiguous shell provider. Admitted providers must belong to the admitted subtree and supply matching host filesystem and subprocess worlds. An auxiliary host group beside a container-backed shell tool does not qualify. The [shell policy](../../../../packages/guard/tool-policy-shell/README.md) verifies the requesting Agent's effective execution context: verified container operations retain their exemption, host operations follow ordinary review, and split or unverified worlds fail closed.

Fresh delegated children and independent live forks join the source's exact standing generation while retaining distinct lifecycle ownership. Independent forks use the retained source observation and exact inherited prefix without becoming subagent-owned. A reconstructed admitted child or fork requires its own matching entry. A configured direct parent or the latest recorded host context under a remapped logical preset prevents ordinary cold fallback; neither observation authorizes a join. Cold skill reads retain that refusal instead of returning global skills. A multi-hop history with neither signal requires explicit operator identification in the manifest. The [conversation workspace owner's host allowlist](2026-09-23-admitted-host-conversations.md) remains a separate requirement wherever that owner is composed; preset admission does not bypass its guard.

## Alternatives considered

**Replace the shared logical preset with host providers.** This grants host execution to ordinary conversations that legitimately use the same preset.

**Rewrite headers or append a post-start preset selection.** Both falsify historical identity. Permission selection also cannot transfer execution ownership, as the [host-maintenance decision](2026-09-21-host-maintenance-profiles.md) explains.

**Use only a Session identifier or lineage.** Reused or changed records can retain those fields. Exact restored metadata and the original event prefix establish which history the operator admitted; independently cold descendants require separate authority.

**Infer the environment from any mounted provider.** Instruction readers and other helpers can be host-backed while the shell tool consumes a container executor. Actual consumer bindings determine command execution.

**Promote historical one-shot descriptors.** Placement admission does not change delegation lifecycle authority or make an existing child adoptable through generic Session creation.

## Consequences

Operators maintain explicit entries and execution-only wrappers. Unusable wrappers or mismatched histories fail before publication instead of falling back to another world. Logical fingerprints establish record identity, not preservation of compressed file bytes; import qualification separately verifies original physical prefixes and committed generations. Workspace ownership, operating-system administrative access, authenticated deployment, and rollback remain independent of this admission mechanism.

The [child composition decision](../bug-fix/2026-08-10-child-agents-join-their-parent-preset.md), [host-plane ownership decision](2026-08-10-host-plane-ownership-after-presets.md), and [handoff target decision](2026-10-01-host-handoff-target-profiles.md) retain their distinct ownership and capability guarantees.
