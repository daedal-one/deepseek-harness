# Agent Note: Daedal Web identity and explicit fork overview

Status: implemented

## Problem

The fork needs a recognizable identity beside the Paseo companion and a discoverable explanation of its additions. A mandatory development announcement interrupts both local and remote users without helping them start work.

## Decision

The [theme owner](../../../../packages/client/ui-theme/README.md) supplies coordinated light and dark surfaces and green semantic accents. The [sidebar](../../../../packages/client/ui-sidebar/README.md) uses the companion's Daedal vector mark and opens a localized fork overview from its brand button. Every activation opens it; startup and reload leave it closed. The dedicated New Session control remains the session creation action.

The overview uses the shared modal, makes background controls inert, contains keyboard focus, restores the triggering control on dismissal, and scrolls within the viewport. Its component-local visibility requires no Host setting or acknowledgement. [Credential onboarding](../../../../packages/client/ui-settings-models/README.md) retains its independent conditional step.

## Alternatives considered

A versioned acknowledgement would introduce persistence and remote-browser differences for informational content. Automatic display would interrupt startup. Per-component colors would duplicate theme decisions and risk inconsistent light and dark modes.

## Consequences

The overview is always available without blocking first use. Its summary must track implemented fork capabilities in the root README. The token architecture remains governed by the [styling-system decision](../process/2026-07-19-web-styling-system.md); this decision changes palette and brand behavior only. Component behavior and the keyless remote Web snapshot own overview regression coverage.
