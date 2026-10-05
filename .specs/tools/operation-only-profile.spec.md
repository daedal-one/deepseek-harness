---
id: TASK:tools/operation-only-profile
type: task
status: accepted
summary: Enforce operation-only planning and serve its local decision engine from a separate repository.
owners: [carlo]
progress: in-progress
addresses: ["REQ:tools/operations#c-composition", "REQ:tools/operations#c-policy", "REQ:tools/operations#c-hard-stops", "REQ:tools/operations#c-provider", "REQ:tools/operations#c-verification", "REQ:tools/operations#c-entrypoint"]
labels: [tools, operations, profiles, decision-engine]
groups: []
assignee:
eta:
blocked_by: []
---

# Operation only profile

## Plan

Compose an opt-in agent profile that exposes only `run_operation` to the planning model and rejects direct calls to underlying tools in the executor. Supply a model-visible plan language and the available action schemas. Execute underlying tools through their ordinary permissions and execution providers; permit read/search and small edits autonomously where the session policy permits them. Support foreground shell steps with independent exit, cancellation, timeout and completeness checks. Preserve bounded sequential execution, durable decisions, conservative replanning and at-most-once dispatch.

Move the Python inference service into `daedal-one/decision-engine` with its source history, private serving configuration and independent supervisor. Retain the DSH adapter and wire protocol in this repository. Provision immutable CPU model artifacts on the existing server host, measure actual inference, and verify the new profile without creating another DSH Web server or altering existing sessions.

## Acceptance

Prove direct-call denial through the real executor, successful approved nested dispatch, scope isolation, disposal and failure handling. Exercise an actual Loader profile and keyless Session/SDK replay. Run focused checks and documentation gates. Verify the separate inference service with real weights, bounded CPU/memory ownership and authenticated requests; report model qualification independently. Verify the profile in the existing Web service while preserving its histories and workspaces.
