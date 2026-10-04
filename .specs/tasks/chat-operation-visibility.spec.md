---
id: TASK:ui/chat-operation-visibility
type: task
status: accepted
summary: Retain running and latest operations outside Chat process summaries.
owners: [carlo]
progress: completed
addresses: ["REQ:ui/chat-operation-visibility#c-visible", "REQ:ui/chat-operation-visibility#c-expand", "REQ:ui/chat-operation-visibility#c-replay", "REQ:ui/live-agent-activity-summaries#c-presentation", "REQ:ui/live-agent-activity-summaries#c-evidence"]
---

# Chat operation visibility

## Acceptance

Project the latest Tool tree and latest reasoning-bearing Assistant row per Turn through the existing keyed Chat presentation. Preserve those rows when earlier process material folds, including the final answer's reasoning disclosure. An accepted live activity summary may fold covered earlier operations only behind an interactive Chat disclosure; every running Tool remains visible. Keep controls only for material that can actually be expanded. Verify live-summary expansion, supersession and settlement, parallel running operations, pointer and keyboard expansion, nested calls, history prepend and Normal/Compact switching. Update the owning README, Agent Note, component cases and keyless recorded-session browser expectations.

## Qualification

The owning Chat suite passes 364 cases with two unrelated registration expectations deselected; the changed process helper and store reach 100% statement, branch, function and line coverage. Nine keyless browser cases pass in read-only replay, covering accepted-summary disclosure, Tool and reasoning detail expansion, Compact/Normal switching, live scrolling and history restoration. Host and Client compilation, the integrated build, lint and all 32 documentation gates pass. The complete GUI lane reports three registration and border failures also reproduced on untouched master. The broad browser replay was stopped after 27 completed files reported fixture, profile and expected-output failures; it is not a passing qualification. Recorded Session generations remain unchanged.

## Sources

- [Presentation](spec:src:packages/client/ui-chat/src/client/conversation-nodes/turn-process-presentation.ts)
- [Visibility](spec:src:packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx)
- [Component behavior](spec:src:packages/client/ui-chat/tests/chat-view.client.spec.tsx)
- [Browser behavior](spec:src:apps/web/tests/chat-operation-visibility.e2e.ts)
