# Agent Note: Phone Chat uses the document scroller

Status: implemented

## Problem

The responsive shell filled the phone viewport but kept Chat inside `[data-conversation-scroll]`, a nested `overflow-y: auto` box. Firefox and other iOS browsers retract their navigation chrome only for main-document scrolling, so reading a long conversation could not recover that screen space. Changing CSS alone would have separated the visible scroll owner from Chat's bottom-follow, semantic restoration, prepend anchoring, back-to-bottom, and textarea wheel-chain logic.

## Decision

Below 768px, the Chat layout grows the main document. The frame, center column, conversation root, and ordinary Chat scroll body use auto height with a `100dvh` minimum and visible vertical overflow. The header remains ordinary flow and scrolls away with the transcript, while the composer remains sticky to the visible viewport. Sidebar, details, their mask, and the shell overlay layer use fixed positioning so they continue to cover the current viewport after the document moves.

`ui-conversation` resolves one scroll owner through its internal `scroll-owner.ts`: the nearest `[data-conversation-scroll]` host on desktop and in isolated component rendering, or `document.scrollingElement` when that host is inside `data-phone="true"`. Chat anchor geometry uses browser viewport coordinates for the document owner and element-relative coordinates for the nested owner. Scroll listeners bind both assembled candidates once because crossing the breakpoint does not remount Chat; each event resolves the current owner before reading or writing position. InputBar wheel chaining uses the same resolver.

A view carrying `data-conversation-composer-overlay` retains the bounded nested box and its own internal scrollers. This preserves trajectory virtualization and overlay composer geometry instead of forcing every conversation tab into document flow.

## Alternatives considered

**Nudge `window.scrollTo(0, 1)` when the transcript moves.** Rejected because it simulates browser-toolbar state, competes with reader scroll position, and depends on browser heuristics that the page does not control.

**Move every conversation view to document scrolling.** Rejected because virtualized or independently scrolling views require a bounded viewport. Chat is the flow surface whose transcript naturally defines document height; overlay views keep their existing owner.

**Maintain separate phone implementations of follow and anchoring.** Rejected because the algorithms operate on standard scroll geometry. A shared owner and viewport abstraction preserves one behavior across both layouts and keeps semantic saved positions valid across breakpoint changes.

## Consequences

Mobile browser chrome remains user-agent controlled; document scrolling makes retraction possible but does not force it or override the user's browser setting. The document now carries long-Chat height, so every phone overlay must remain fixed and horizontal bleed must use clipping rather than creating another scroll container. Desktop keeps its resident bounded scrollport and unconditional scrollbar gutter.

Focused tests route bottom-follow, reader events, wheel chaining, and anchor geometry through the document owner. The assembled lifecycle scenario adds long flow at 390×844, scrolls `document.scrollingElement`, verifies the nested host stays at zero, checks the sticky composer remains visible, and opens fixed sidebar and settings overlays while the document is displaced.
