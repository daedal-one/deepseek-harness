---
id: REQ:ui/plugin-inventory-metadata
type: requirement
status: accepted
level: MUST
summary: The Web plugin inventory identifies every Loader entry with visible package authorship, purpose, and release metadata.
owners: [carlo]
refines: []
categorized_under: []
---

# Plugin inventory metadata

## Context

Module names and runtime state do not explain how installed plugins differ or
who publishes them. The inventory needs package-owned metadata while the Loader
remains authoritative for composition and lifecycle state.

:::{requirement id="plugin-inventory-metadata" level="MUST"}
- {#c-projection} The Host inventory MUST project each non-group Loader entry's
  package author, description, and version when its package manifest declares
  them, and MUST represent unavailable fields without inventing package facts.
- {#c-presentation} Every Plugin list card MUST display author, description, and
  version before disclosure, MUST use explicit copy for unavailable fields, and
  MUST include available metadata in local search.
- {#c-layout} The Plugin catalog MUST render one card per row at every viewport
  width so each card has the full catalog width for metadata and status labels.
- {#c-state-filter} The Plugin catalog MUST offer a state filter beside search,
  MUST cover effective enablement and every visible Cordis phase, and MUST
  combine the selected state with the local text query.
- {#c-authority} Package metadata lookup MUST NOT cache, replace, or infer Loader
  enablement and Fiber state; every inventory read MUST continue to project
  lifecycle state from the current Loader tree.
:::
