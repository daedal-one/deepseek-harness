# Agent Note: Daedal tool-policy permission mode

Status: implemented

## Problem

Mounting Daedal's [model-backed tool-policy capability](2026-08-16-model-backed-tool-policy.md) made its auxiliary review apply under every permission preset. That erased the product distinction between ordinary workspace confinement, independently reviewed unconfined commands, and explicit Full access. A preset label alone could not restore the distinction because enforcement occurs at tool pre-execution and must follow the session's durable permission state.

## Decision

`dsh-tool-policy-enforcer` accepts an optional `enforceWhen` conjunction over `sandbox/mode` and `approval/policy`. It folds the configured values from the calling session's durable events before provider evaluation. The configuration schema preserves an omitted condition as absent for unconditional enforcement and requires every configured value list to be non-empty. A missing durable value keeps enforcement active because absence cannot establish a bypass.

The Daedal host patch owns a four-entry permission table in presentation order: `read-only`, `workspace-write`, `policy-reviewed`, and `danger-full-access`. `policy-reviewed` is `danger-full-access + ask`; the enforcer selects only that pair. The existing permission projection and Settings schema carry the new option to both browser selectors, so the UI needs no Daedal-specific branch. Full access remains the only option behind the [existing explicit risk acknowledgement](2026-07-31-gui-full-access-confirmation.md).

The policy providers remain responsible only for their configured tools. Daedal reviews mapped shell calls and its scoped MCP rules; unsupported tools continue under their own enforcement mechanisms. The middle mode therefore means full file access plus independent review for those supported operations, not universal model authorization of every tool.

## Alternatives considered

**Key enforcement directly to the preset name.** Rejected because the sandbox and approval events are the authoritative mechanism values, while `permission/preset` preserves product intent and may share a bundle with another name. Enforcement follows the values that determine execution.

**Add a third mechanism knob to permission presets.** Rejected because activation is already expressible as a deployment-owned predicate over the two durable values and adding another event would duplicate state.

**Hard-code Policy reviewed in the browser.** Rejected because the existing projection and Settings schema already preserve deployment table order, labels, and descriptions. A client special case would make Daedal configuration non-authoritative.

## Consequences

Workspace-confined Daedal sessions make no auxiliary policy requests. Policy reviewed sessions use unconfined file permissions while supported shell and MCP calls receive the independent policy review and route genuine asks directly to the approval service. Full access performs neither auxiliary review nor approval prompting. Existing non-Daedal enforcer compositions keep their unconditional behavior unless they configure `enforceWhen`.
