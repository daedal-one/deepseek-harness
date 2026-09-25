---
id: TASK:ui/access-mode-hover-descriptions
type: task
status: accepted
summary: Explain access modes when users hover or focus their Web controls.
owners: [carlo]
progress: done
addresses: []
labels: [web, ui, permissions, accessibility]
assignee: carlo
---

# Access mode hover descriptions

## Acceptance

The Web composer provides concise locale-owned descriptions for the built-in Read Only, Workspace Write, and Full access modes. The closed access control and each described menu row expose the same tooltip on hover and keyboard focus. A host-provided description takes precedence over built-in fallback copy. The Full access fallback limits policy reach to the displayed environment and does not imply container escape or host access. Menu tooltip wrapping preserves complete top-level and submenu button targets.
