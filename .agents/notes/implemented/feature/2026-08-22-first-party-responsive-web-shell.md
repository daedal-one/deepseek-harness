# Agent Note: First-party responsive Web shell

Status: implemented

## Problem

The Web shell treated narrow viewports as a squeezed desktop. Below 1024px it collapsed the sidebar to a permanent 56px rail, but the rail still consumed conversation width, opening the sidebar compressed the center to a sliver, details conceded to zero before they could be used, and the desktop settings columns exceeded a phone viewport. The conversation and composer had local narrow-width behavior, but the frame never gave them the full screen.

## Decision

The existing presentation owners adapt their own surfaces below 768px. `ui-layout` keeps the resident slot tree and transient panel store, replaces the three grid tracks with one conversation track, and positions sidebar and details as overlays. The collapsed sidebar remains a 56px top-left seat containing only `ui-sidebar`'s existing localized toggle; expanding it restores the complete sidebar at `min(86vw, 320px)` over a dismissible mask. Requested details cover the conversation at full width and become inert and hidden from accessibility APIs while closed; the conversation also becomes inert while either phone overlay covers it. Desktop concession, drag, and rail behavior remains unchanged at and above the phone breakpoint.

`ui-conversation` owns phone transcript, header, tabs, composer safe-area, visible-viewport geometry, and compact control-row labels. Its tool-approval takeover preserves the [safe-action focus contract](../bug-fix/2026-07-30-approval-panel-command-cap.md) at phone widths, and every built-in permission mode supplies a glyph so the compact access trigger never competes with the model label. `ui-settings-general` turns its modal into a full-viewport column with horizontally scrolling section navigation and an independently scrolling options region. The implementation uses component state, owner props, CSS modules, and stable attributes emitted by the owning frame; it introduces no DOM discovery controller or replacement shell.

Browser zoom remains browser-owned. Root navigation gestures and hover-preview input policy follow the [touch boundary and hover-preview guards](../bug-fix/2026-08-24-touch-boundary-and-hover-preview-guards.md): the shell owns standard CSS boundary suppression, and the primitives own their triggers. Responsive layout does not register a service worker, PWA manifest, push channel, or global touch listener.

## Alternatives considered

**Install or absorb `jasondu/dsh-ui-mobile` at `3ba0c08c8a1cb542861768f499f558d5a1df6b72`.** Its off-canvas panels, dismissible mask, `100dvh`, safe-area clearance, and reduced-motion handling were useful prior art. Rejected as a runtime dependency because it discovers and stamps another plugin's DOM through mutation observers, adds a second reactive state source, disables page zoom, claims the left-edge touch gesture, and couples responsive layout to unrelated PWA and notification behavior.

**Add a first-party mobile plugin beside the layout owners.** Rejected because frame geometry, sidebar rail presentation, conversation spacing, and settings chrome already have distinct owners. A second plugin would need global selectors or new cross-package control faces to override facts those packages can express directly.

**Hide the sidebar completely and add a new mobile navigation bar.** Rejected because the sidebar already owns a localized, keyboard-accessible toggle. Keeping that control as the collapsed phone seat avoids duplicate navigation state and preserves the existing action path.

**Move phone scrolling from the transcript to the main document.** The initial shell retained the nested owner because transcript following, anchoring, sticky composer placement, and composer-overlay views all targeted it. The [phone document-scroller decision](2026-08-22-phone-document-scroll.md) reverses this alternative with one responsive owner abstraction while preserving those behaviors.

## Consequences

Phone layout is a projection of the same panel preferences and mounted slot entries as desktop, so resizing across 768px does not create another session, composer, details, or settings tree. The sidebar opening transition expands from its compact control seat rather than sliding a separate off-screen copy. Full-width details intentionally cover the conversation; their existing close action is the return path.

The breakpoint is coordinated across the four owning CSS modules and `ui-layout`'s viewport decision. Focused component tests pin phone state and desktop preservation, style tests pin each owner's responsive geometry, and two assembled browser scenarios cover the phone viewport: lifecycle checks full-width conversation, sidebar masking, settings fit, and document overflow at 390×844; approval checks safe-action focus.
