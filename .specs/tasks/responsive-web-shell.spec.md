---
id: TASK:ui/responsive-web-shell
type: task
status: accepted
summary: Adapt the first-party Web shell for sustained phone use.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/responsive-web-shell#c-frame
  - REQ:ui/responsive-web-shell#c-navigation
  - REQ:ui/responsive-web-shell#c-conversation
  - REQ:ui/responsive-web-shell#c-settings
  - REQ:ui/responsive-web-shell#c-accessibility
  - REQ:ui/responsive-web-shell#c-touch-interaction
  - REQ:ui/responsive-web-shell#c-desktop
labels: [web, ui, responsive, mobile]
assignee: carlo
---

# Responsive Web shell implementation

## Acceptance

The first-party layout, sidebar, conversation, details, settings, shell, and primitive owners implement the accepted phone interaction without a replacement shell or third-party runtime plugin. Focused component coverage pins drawer state, desktop preservation, and hoverless preview suppression. Assembled browser coverage verifies the phone viewport prevents boundary overscroll, has no horizontal page overflow, keeps navigation, composer, details, and settings usable, and retains focus on the safe action when tool approval replaces the composer.
