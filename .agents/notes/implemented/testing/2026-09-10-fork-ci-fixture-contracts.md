# Agent Note: Fork CI fixtures follow their configured provider and execution lane

Status: implemented

## Problem

A fixture can retain an upstream provider, translated label, or service composition after the application changes. Such a test fails before reaching the behavior it owns. Local build outputs can also hide a unit test's dependency on an assembled client artifact.

## Decision

The Python SDK's ordinary runtime smokes use OpenRouter with a catalog model, a dummy credential, and a loopback model server. The in-history system-prompt scenario explicitly selects the dedicated DeepSeek adapter already present in the minimal profile because that adapter owns the tested capability. Its dummy credential and endpoint belong to the fixture. Real-provider workflows require the OpenRouter repository secret before running and reject missing credentials instead of reporting skipped requests as successful validation.

MCP fixtures mount the local subprocess service required by their stdio transports. Client fixtures provide the current service interfaces and assert the maintained English UI copy. Unicode payload fixtures remain independent of UI language.

Assembled client recovery runs in the built-browser lane. Source unit tests do not rely on pre-existing client output. Browser dependency discovery canonicalizes its repository root before passing it to Vite, whose default resolver follows filesystem symlinks. The existing temporary-root fixture exercises this relationship on macOS.

These rules complement the [fixture synchronization decision](2026-09-08-ci-completion-observations.md) and [runner temporary-storage decision](2026-09-06-pr-ci-runner-temporary-storage.md); their resource-lifetime and synchronization requirements remain active.

## Alternatives considered

- Increase timeouts for missing MCP tools: the missing service prevents startup regardless of the timeout.
- Build before the unit suite: this hides an artifact dependency and makes clean-checkout unit results differ from developer machines.
- Disable assertions or provider preflight: a successful job would no longer demonstrate the behavior it advertises.

## Consequences

Provider changes require corresponding fixture model and credential changes. Package tests establish local behavior; installed-wheel smokes and built-browser checks establish artifact behavior. Hosted platform results and real-provider results remain separate evidence.
