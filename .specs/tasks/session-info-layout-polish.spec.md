---
id: TASK:ui/session-info-layout-polish
type: task
status: accepted
summary: Keep Info tab facts readable across narrow and wide conversation view widths.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:ui/session-info-tab#c-ui
  - REQ:ui/session-info-tab#c-spend
labels: [ui, web, layout]
assignee: carlo
---

# Session information layout polish

## Acceptance

The Info tab keeps its existing facts, copy, reading order, and independent spend failure behavior. The summary and Spend sections span the view; the other cards use at most two columns, becoming a single column at narrow view widths. Fact rows align labels and values without squeezing or clipping long identifiers and paths, and stack when the card becomes too narrow for two columns. Summary text has a readable line length. The key-usage heading and facts form one grid item beside the session estimate, whose model and provider appear on separate lines; the spend items stack at narrow widths. Focused component coverage checks the spend grouping and preservation of long values.
