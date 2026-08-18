---
id: TASK:ui/plugin-inventory-state-filter
type: task
status: accepted
summary: Add a local state filter beside Plugin inventory search.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/plugin-inventory-metadata#c-state-filter
labels: [web, plugins, settings, filtering]
assignee: carlo
---

# Plugin inventory state filter

## Acceptance

The Plugin list places an accessible state selector beside search. It filters
by effective enablement or a displayed Cordis phase, composes with the text
query, updates the visible count, and does not issue another Host read.
