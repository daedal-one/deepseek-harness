# Agent Note: Width handles follow the content-axis View

Status: implemented

## Problem

The transcript drag handles beside the conversation column render for every View of an active Session. They exist only to drag the shared content-width axis (`--dsh-chat-content-width`), which the Chat View lays its transcript on. The Prompt and Info tabs render full-bleed reading panes with their own scrollers, so the 40px strips sat over content that does not move: a col-resize cursor and a click-stealing hit area over text and cards. The existing suppression was keyed on `[data-conversation-composer-overlay]`, which only the Trajectory and Terminal Views elect, so those two tabs lost the strips while Prompt and Info kept them.

## Decision

The strips are elected by the View that reads the axis, not suppressed by a View that happens to own a composer overlay. `ChatView` publishes `data-conversation-width-axis` at its root, and `ConversationRoot.module.css` hides `.widthHandle` unless the column contains that marker.

Trajectory, Terminal, Prompt, Info, and any later View leave the marker unset and get no strips, whether or not they also elect the composer overlay. The overlay-keyed hide rule is gone, so the overlay attribute now carries composer geometry alone.

## Alternatives considered

**Keep keying the hide rule on the composer overlay.** This is the defect: the overlay is a composer-geometry choice, and a full-bleed View that keeps the shared composer (Prompt, Info) never sets it.

**Mark each full-bleed View and keep the opt-out direction.** Every present and future reading View must remember to declare itself; forgetting leaves dead strips stealing clicks over its content, which fails open exactly as this bug did. Electing the axis fails closed instead: a View without the marker gets no drag affordance.

## Consequences

Only the Chat tab offers the drag gesture; its persisted width preference still applies to the transcript and composer card wherever they render. The composer card continues to ride the axis on every tab, because the axis is a property of the column rather than the View. [Component tests](../../../../packages/client/ui-chat/tests/chat-view.client.spec.tsx) pin the marker at the Chat root and [stylesheet assertions](../../../../packages/client/ui-conversation/tests/width-handle-axis.client.spec.ts) pin the hide rule; the [browser test](../../../../apps/web/tests/view-tab-width-handles.e2e.ts) drives the built product across all four tabs.
