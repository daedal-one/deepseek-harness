# Agent Note: Phone floating conversation header

Status: implemented

## Problem

The [document-scroller decision](2026-08-22-phone-document-scroll.md) lets mobile browser chrome retract, but it also moved the complete session header away with the transcript. A reader deep in a conversation had to return to the document top to reach the title actions and view tabs. Keeping the header permanently visible would recover those controls by continuously consuming scarce phone height.

## Decision

`ConversationRoot` keeps the session header in its existing resident tree and wraps it in one header seat. Below 768px, that seat is sticky at the top of the document, paints the solid base background above transcript content, and translates above the viewport after 24px of continuous downward travel. Eight pixels of continuous upward travel, reaching the document top, resizing across layout modes, or moving keyboard focus into the header restores it. Direction changes reset the travel measurement so sub-pixel scroll noise cannot toggle the bar. Focus restoration is immediate, and reduced-motion preference removes the ordinary scroll transition.

The root listens to the same host-and-document event targets as Chat and resolves the active owner on every event through `scroll-owner.ts`. Only document-owned phone scrolling changes header visibility; desktop and bounded overlay views keep their existing static header. The seat remains in normal flow at the transcript start, so its initial height clears the first content before sticky positioning makes it float over later content.

## Alternatives considered

**Keep the phone header permanently sticky.** Rejected because the title row and optional tabs would reserve viewport height throughout reading, opposing the document-scroller goal of recovering vertical space.

**Use a fixed header with a measured spacer.** Rejected because title ancestry, actions, utilities, and tabs can change the header height. Sticky positioning preserves the natural initial clearance without another measurement channel.

**Observe a top sentinel.** Rejected because intersection only distinguishes the document start from later content; it cannot reveal the downward-versus-upward direction that controls reappearance.

**Listen only to `window` scrolling.** Rejected because the resident conversation crosses the phone breakpoint without remounting and desktop still owns a nested scrollport. The existing responsive owner utilities keep one listener path valid across both layouts.

## Consequences

The phone header occupies normal flow only at the document start, floats with an opaque surface while visible later, and gives that space back while the reader moves down. Any upward movement restores the controls immediately; keyboard navigation cannot leave them translated off-screen. Desktop header geometry and non-Chat overlay scrolling remain unchanged.

Focused component tests pin owner-aware direction changes, top restoration, keyboard-focus restoration, desktop preservation, and breakpoint resets. Responsive style tests pin sticky positioning, solid fill, transform transition, and reduced motion. The assembled 390×844 scenario verifies the header hides on downward document scroll, returns at the viewport top on upward scroll, and does not cover the initial transcript.
