---
id: TASK:ui/english-only-refresh
type: task
status: accepted
summary: Restore English-only product copy and repository guidance after the upstream rebase.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/english-only#c-product
  - REQ:ui/english-only#c-fallback
  - REQ:ui/english-only#c-prose
  - REQ:ui/english-only#c-exceptions
labels: [web, settings, documentation]
assignee: carlo
---

# English-only refresh

## Acceptance

One English dictionary per feature supplies typed UI copy. Shipped presets and active repository guidance are English. Unsupported locales fall back to English, plugin language packs remain supported, and meaningful multilingual fixtures remain intact. Locale, UI, documentation, and assembled Web checks validate the change before it reaches the retained server.
