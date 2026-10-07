---
id: REQ:session/reporting-disabled
type: requirement
status: accepted
level: MUST
summary: Shipped profiles and omitted plugin configuration keep outbound diagnostics disabled.
owners: [carlo]
refines: []
categorized_under: []
---

# Outbound reporting defaults

:::{requirement id="reporting-disabled" level="MUST"}
- {#c-defaults} Shipped profiles MUST disable OTel session export, DeepSeek session-log contributions, and plugin-package inventory contributions. Omitted plugin configuration MUST NOT enable outbound reporting. Feedback MUST remain local under these defaults.
- {#c-identifiers} Ordinary DeepSeek requests MUST NOT attach Harness user ids, Session ids, or compaction diagnostic headers.
- {#c-optout} Any non-empty `DSH_TELEMETRY_DISABLED` MUST disable all three reporting plugins after user overlays, including rows with custom ids. Empty or absent switches MUST preserve explicitly configured opt-ins.
- {#c-native} DSH-launched Codex and Claude subprocesses MUST disable their native analytics, feedback/error reporting, and OTel exporters after inherited or provider-supplied configuration. Native model execution and authentication MUST remain available.
- {#c-evidence} Tests MUST prove absence of reporting with omitted configuration and after hard opt-out. Explicit test-only reporting compositions MAY exercise the retained optional providers against local collectors.
:::
