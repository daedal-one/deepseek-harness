---
id: TASK:ui/resilient-client-plugin-loading
type: task
status: accepted
summary: Recover Web boot from one transient client-plugin script failure.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/responsive-web-shell#c-boot-recovery
labels: [web, ui, mobile, reliability]
assignee: carlo
---

# Resilient client-plugin loading

## Acceptance

The browser retries one external client-plugin script after its first load error, shares the retry across concurrent callers, removes every settled script element, and retains the existing fail-loud report when the retry also fails. Focused module-loader coverage and an assembled keyless Web boot abort the first lazy-plugin request and prove that the UI still settles.
