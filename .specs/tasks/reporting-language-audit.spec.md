---
id: TASK:maintenance/reporting-language-audit
type: task
status: accepted
summary: Disable outbound reporting defaults and repair remaining non-English UI assertions.
owners: [carlo]
progress: done
addresses:
  - REQ:session/reporting-disabled
  - REQ:ui/english-only
labels: [privacy, web, documentation]
assignee: carlo
---

# Reporting and repository language audit

## Acceptance

Disable every shipped reporting row, make optional reporting plugins default to disabled, remove per-user and per-Session diagnostic headers, and extend the launcher hard opt-out to all reporting modules regardless of row id. Force native Codex and Claude reporting off after inherited configuration. Verify ordinary requests and feedback do not send diagnostics. Align browser assertions and generated expectations with English dictionaries; preserve released Session generations, meaningful multilingual fixtures, vendor sources, and frozen notes. Run focused provider, launcher, locale, browser-expectation, and documentation checks.
