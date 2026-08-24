---
id: REQ:ui/responsive-web-shell
type: requirement
status: accepted
level: MUST
summary: The Web shell remains usable as a touch-first single-column interface on phone-sized viewports without changing desktop behavior.
owners: [carlo]
refines: []
categorized_under: []
---

# Responsive Web shell

## Context

The desktop shell keeps a collapsed sidebar rail and fixed three-column geometry on narrow screens, which leaves the conversation, composer, details, and settings surfaces too constrained for sustained phone use.

:::{requirement id="responsive-web-shell" level="MUST"}
- {#c-frame} Below the phone breakpoint, the conversation MUST occupy the full viewport width while the sidebar and details surfaces MUST open as independent overlay drawers without shrinking the conversation.
- {#c-navigation} The phone layout MUST keep sidebar and details navigation reachable through labeled controls, MUST provide an outside-click close path for an open drawer, and MUST preserve each panel's existing explicit close action.
- {#c-conversation} The transcript and composer MUST fit the phone viewport without horizontal page overflow, MUST keep the composer reachable when the visible viewport changes, MUST preserve readable touch and input targets, and MUST keep the access-mode control from overlapping the model selector.
- {#c-settings} The settings dialog MUST fit within the phone viewport, MUST keep its section navigation and close action reachable, and MUST scroll section content independently.
- {#c-accessibility} Responsive behavior MUST preserve keyboard focus visibility, browser zoom, accessible names, and reduced-motion preferences; a tool-approval takeover MUST move focus from the replaced composer to its safe rejection action.
- {#c-desktop} At and above the phone breakpoint, the existing three-column sizing, collapsible control rail, resize handles, composer geometry, details behavior, and settings layout MUST remain unchanged.
:::
