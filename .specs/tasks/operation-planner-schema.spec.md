---
id: TASK:tools/operation-planner-schema
type: task
status: accepted
summary: Describe operation plans structurally and guide the planner toward bounded evidence collection.
owners: [carlo]
progress: done
addresses:
  - REQ:tools/operations#c-plan
  - REQ:tools/operations#c-planner
  - REQ:tools/operations#c-entrypoint
  - REQ:tools/operations#c-evidence
  - REQ:tools/operations#c-verification
labels: [tools, operations, experimental]
---

# Operation planner schema and first action

## Scope

Expose required version-one plan fields, tagged expression and assertion alternatives, observations, completion, and optional tightening limits through the existing tool-schema vocabulary. Retain the strict parser for recursive expressions, reference validity, nonempty collections, and numeric constraints. Give the scoped planner a valid foreground-shell example only when that action is available, and guide it to collect the requested facts in the smallest useful plan, reuse settled evidence, and answer once sufficient.

## Acceptance

Missing versions and raw argument objects fail tool admission before effects. Valid expression and assertion alternatives remain accepted. The emitted shell example executes through the ordinary tool pipeline against an isolated repository. Keyless supported-profile replay records the changed schema and scoped planner guidance. Deterministic evidence remains separate from live model behavior; permissions, hard stops, inference limits, and stored Sessions remain unchanged.
