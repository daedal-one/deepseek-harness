---
id: REQ:ui/chat-operation-visibility
type: requirement
status: accepted
level: MUST
summary: Compact session chats preserve visible current activity and expandable earlier operations.
owners: [carlo]
---

# Chat operation visibility

:::{requirement id="chat-operation-visibility" level="MUST"}
- {#c-visible} Compact Chat MUST keep running operations, the latest Tool call tree and the latest nonempty reasoning disclosure visible in each Turn, including reasoning accompanying its final answer.
- {#c-expand} Earlier process material MUST remain available through a keyboard-accessible disclosure without losing recorded content, nested Tool calls or individual detail expansion. A Turn with no remaining folded material MUST NOT show an empty process disclosure.
- {#c-replay} Visibility MUST agree across streaming settlement, history loading and replay. Presentation changes MUST NOT alter durable Session data, model requests or permission policies.
:::

## Sources

- [Chat presentation](spec:src:packages/client/ui-chat/src/client/conversation-nodes/turn-process-presentation.ts)
- [Chat node visibility](spec:src:packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx)
