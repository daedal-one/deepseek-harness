# Agent Note: Disabled outbound reporting

Status: implemented

## Problem

Feedback can contain complete conversation history, tool output, and workspace paths. A feedback action does not provide the fork with authority to report that data externally. Ordinary DeepSeek requests can also disclose persistent installation and Session identifiers independently of the exporter.

## Decision

The shipped base disables OTel export, Session-log contributions, and plugin-package inventory. Omitted OTel and inventory configuration disables reporting. DeepSeek requests omit user, Session, and compaction diagnostic headers. Static public application attribution remains provider metadata without user or Session identity.

The launcher applies any non-empty `DSH_TELEMETRY_DISABLED` after user overlays to every reporting module, matching module identity rather than a fixed row id. Explicit deployment opt-ins remain available when this switch is absent; OTel opt-ins supply their own collector endpoint. Local Session persistence and feedback remain available. DSH-launched Codex children force analytics, feedback, and every OTel exporter off through command-line overrides; Claude children force native and OTel reporting off at the final SDK subprocess overlay. Provider environment and native user settings cannot re-enable these child reporting paths.

English dictionaries own product labels. Browser assertions and generated expectations consume that English output. Multilingual parsing, rendering, and output-enforcement fixtures, released Session recordings, vendored source, and frozen notes retain their content under the [English requirement](../../../../.specs/ui/english-only.spec.md).

The [feedback-default decision](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md) motivated uploads as diagnostic evidence without reproducing a failed Session. The [request-identity decision](../../archived/feature/2026-08-11-deepseek-request-user-id-header.md) motivated support correlation across Sessions. These diagnostic benefits do not justify automatic disclosure in this fork. The optional feedback-authorization mechanism and request-extension formats remain supported.

## Alternatives considered

**Disable only the OTel row.** Session-log and inventory fields can still leave through ordinary model requests, and user identity headers bypass all three plugins.

**Rely on a local environment variable.** Fresh installations and alternative profiles must be private without deployment setup; the variable is an additional hard opt-out.

**Delete every Chinese character.** Rendering and language-enforcement tests require multilingual input, and released recordings and frozen artifacts have preservation obligations. Product copy and active prose remain English.

## Consequences

Feedback remains local by default, and provider-side support cannot correlate ordinary requests using Harness installation or Session identifiers. Operators who explicitly enable optional reporting own its destination and redaction policy. Regression tests cover default-off behavior, wire-header absence, all-module opt-out, and English UI assertions. Live collector acceptance and retained-service activation require separate deployment evidence.
