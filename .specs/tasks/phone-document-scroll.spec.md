---
id: TASK:ui/phone-document-scroll
type: task
status: accepted
summary: Make the phone Chat transcript scroll through the main document.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/responsive-web-shell#c-document-scroll
  - REQ:ui/responsive-web-shell#c-conversation
  - REQ:ui/responsive-web-shell#c-accessibility
  - REQ:ui/responsive-web-shell#c-desktop
labels: [web, ui, responsive, mobile, scrolling]
assignee: carlo
---

# Phone document scrolling

## Acceptance

The phone Chat layout grows the document instead of retaining a nested vertical scrollport. Its existing transcript-follow, restore, prepend-anchor, back-to-bottom, textarea wheel-chain, sticky-composer, and floating-header behaviors target the document scrolling element, while desktop and internally virtualized non-Chat views retain their current scroll owners. The solid session header hides during downward scrolling, returns during upward scrolling or keyboard focus, and follows reduced-motion preferences. Assembled browser coverage proves the document scrolls at 390×844, the transcript element does not, the composer remains reachable, and the header floats without covering the initial transcript.
