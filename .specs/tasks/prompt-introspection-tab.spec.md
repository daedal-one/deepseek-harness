---
id: TASK:ui/prompt-introspection-tab
type: task
status: accepted
summary: Add a sessionInfo.readPrompt Remote read and a searchable Prompt conversation view over the Session's logged system prompt and tool catalog.
owners: [carlo]
progress: done
addresses:
  - REQ:ui/prompt-introspection-tab#c-read
  - REQ:ui/prompt-introspection-tab#c-source
  - REQ:ui/prompt-introspection-tab#c-degrade
  - REQ:ui/prompt-introspection-tab#c-ui
  - REQ:ui/prompt-introspection-tab#c-search
labels: [ui, web, session]
assignee: carlo
---

# Prompt introspection tab

## Scope

The existing `@deepseek-ai/dsh-session-info` Host capability at `packages/api/session-info` gains a second Remote method, `sessionInfo.readPrompt({ sessionId })`, and the existing client package `@deepseek-ai/dsh-client-ui-session-info` at `packages/client/ui-session-info` gains a second `conversation.view` entry, id `prompt` at order 30, beside a re-laid-out Info entry. The Info tab's existing readings, the `openrouterSpend` Remote, the web profile's mounted rows, and the conversation view slot are unchanged. No new package, no new Remote namespace, and no client dependency is added.

## Acceptance

`sessionInfo.readPrompt` answers the rendered system prompt from the last system-role message of `Session.deriveMessages()`, the tool catalog from `Session.requestHeader()?.tools` mapped to `{ name, description, parameters }`, the provider and model from that header's config, and its own `readAt`; it appends no Session event and reads no projection or peer. An empty surface answers `systemPrompt: ''` with an empty tool list and a null model, and a Session absent from the live registry or an already-aborted request answers the stated `session-unavailable` failure. The tool `parameters` field is the locally declared `SessionPromptSchema` JSON union, not an open `Record<string, unknown>`, because the Typert Remote boundary rejects unconstrained `unknown` data and the browser-safe vocabulary module keeps no import edge of its own.

The client registers two localized entries: `info` at order 20 with its existing two-callback store, and `prompt` at order 30 with its own store and a single `loadPrompt` callback, so opening one tab never reads the other's Remote. The Prompt view renders the prompt text with its line and character figures and the assembled route, one card per tool with its parameter count, description, declared parameter rows, and raw JSON Schema, and an explicit absence for an empty prompt, an empty catalog, and a schema that declares no type or no properties. One search box filters the catalog by name, description, or parameter and reports the prompt occurrence count. The Info view keeps its six blocks in the same DOM order, now in a responsive grid with the summary and spend blocks spanning full width and the Refresh control moved into a toolbar that carries the read time.

## Verification

`packages/api/session-info/tests/service.spec.ts` pins the prompt reading's system-node rule (last node wins, text blocks join, a non-text block renders through its JSON form), the tool catalog mapping, the route, the explicit empty reading, the unavailable Session, and the aborted request. `packages/client/ui-session-info/tests/prompt-format.client.spec.ts` pins the pure helpers (parameter rows, the search filter, occurrence counting, prompt figures, schema printing), and `tests/prompt-view.client.spec.tsx` pins the loading, ready, absence, search, failure, and refresh states plus the plugin registration and dispatch, including both abort rails. `tests/info-view.client.spec.tsx` continues to pin the Info view's blocks, its failure degradation, and its own dispatch.

`spec lint` was unavailable in this environment because the forge-spec CLI is not installed; the requirement and task files follow the accepted Specs Format v0.6 shape used by the neighboring UI specs.
