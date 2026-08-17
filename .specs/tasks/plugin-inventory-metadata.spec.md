---
id: TASK:ui/plugin-inventory-metadata
type: task
status: accepted
summary: Display package author, description, and version for every entry in the Web plugin inventory.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/plugin-inventory-metadata#c-projection
  - REQ:ui/plugin-inventory-metadata#c-presentation
  - REQ:ui/plugin-inventory-metadata#c-authority
labels: [web, plugins, settings, metadata]
assignee: carlo
---

# Plugin inventory package metadata

## Acceptance

The Host inventory resolves package-manifest metadata without changing Loader
lifecycle authority. Every Plugin list card displays an author, description,
and version before disclosure, uses explicit unavailable copy for missing
fields, and includes the metadata in local search. Focused Host, component, and
real Web-composition coverage verifies the projection and presentation.
