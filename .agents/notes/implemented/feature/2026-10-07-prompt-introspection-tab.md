# Agent Note: A Prompt view over the Session's logged system prompt and tool catalog

Status: implemented

## Problem

The Web client could say what a Session is ([the Info tab](2026-10-01-session-info-tab.md)) and what it did (Chat, Trajectory), but not what it was *told*. The rendered system prompt existed in the client only as a collapsed per-request row inside the transcript, and the assembled tool catalog — every tool's description and argument schema, including tools the Session never called — existed only as request-header detail attached to individual Trajectory rows. Diagnosing instruction drift, an unexpected tool call, or a tool that never reached the model meant reading the transcript request by request, and the two facts that define a request's instruction surface had no home of their own.

## Decision

The [Prompt introspection intent](../../../../.specs/ui/prompt-introspection-tab.spec.md), carried by the [implementation task](../../../../.specs/tasks/prompt-introspection-tab.spec.md), adds a second Typert Remote read to the existing Host capability and a second conversation view entry to the existing client package. No package, Remote namespace, mounted profile row, or client dependency is added.

**The Host reads its own log folds.** `sessionInfo.readPrompt({ sessionId })` in `packages/api/session-info` answers `Session.deriveMessages()`'s last system-role message — the node an `'in-history'` route reads as authoritative — plus `Session.requestHeader()`'s tool schemas and config route, with a `readAt`. Text blocks join with newlines and a non-text block renders through its JSON form, so an unusual system message is visible rather than silently dropped. Both folds are incrementally cached by the Session, so a read costs only the events appended since the last one, and `readPrompt` reads no projection, no peer service, and writes nothing.

**The reading is a stated absence, not a fabricated one.** An empty surface answers `systemPrompt: ''`; a Session with no logged request header answers an empty tool list and a null model; a Session that is not live, or a request aborted before the read, answers the stated `session-unavailable` failure the Info read already uses. The service therefore keeps one failure vocabulary across both reads.

**The tool schema crosses the Remote boundary as declared JSON.** `ToolSchema.parameters` is declared `Record<string, unknown>`, which the Typert generator refuses at a Remote boundary ("unconstrained unknown data"). The payload therefore declares `parameters: SessionPromptSchema`, a JSON union declared beside the payload in the browser-safe `types` module, and the mapping site asserts it, because a logged tool schema reached the log through session-event validation, which requires JSON. Declaring the union locally rather than importing a utility package's JSON alias keeps that shared vocabulary module free of an import edge, so a browser consumer of `@deepseek-ai/dsh-session-info/types` needs no new dependency to compile it.

**The Prompt view is a separate tab with its own store.** `packages/client/ui-session-info` registers a second `conversation.view` entry, id `prompt` at order 30, behind its own single-reading store and `loadPrompt` callback, so opening Info never reads the prompt Remote and opening Prompt never reads spend. The view renders the prompt in a code surface with line and character figures and the assembled route, then one card per tool: parameter count, description, a disclosure of declared parameter rows (name, declared JSON Schema type, required marker, description), and a disclosure of the raw schema. One search box filters the cards by name, description, or parameter and reports the query's occurrences in the prompt. The Info view itself kept its six blocks in the same DOM order but moved to a responsive grid — summary and spend spanning full width, Refresh and the read time in a toolbar — so the two tabs read as one surface.

Pure presentation helpers (`parameterRows`, `filterTools`, `countOccurrences`, `promptStats`, `formatSchema`) live in `prompt-format.ts` and return nulls for copy the dictionary owns, such as the wording for an undeclared parameter type.

## Alternatives considered

**A section inside the Info tab instead of a tab.** This was the smaller change, and the request that motivated it allowed either placement. Rejected because Info already renders six blocks and the catalog is a search-driven list whose result count must be visible beside the query; folding it in would either bury the tools below the spend block or push the general facts off the first screen. A separate entry also lets the prompt read fail without failing the Info reading.

**A client-only fold over the loaded Session window.** Rejected because the client holds a paged history window, not the whole log, so the latest request header and the effective system node would be absent exactly when a Session is long enough to need them; and because the client-side conversation machinery that interprets `request/header` (the Trajectory definitions) is a different package's internals that a new tab must not reach into. The Host already caches both folds.

**A live `systemPrompt.assemble()` read for a section breakdown.** This would have attributed each prompt paragraph to the plugin that contributed it, which is genuinely better introspection. Rejected because assembly runs the `system-prompt/assemble` waterfall and every registered section provider from a read path, so a diagnostics tab could trigger provider work and would report a prompt that differs from the one actually sent. The log holds the exact request state; a section breakdown needs its own decision about running providers on demand.

**A dedicated `promptCatalog` session projection.** Rejected for the reason the [Info note](2026-10-01-session-info-tab.md) rejected a `sessionInfo` projection, plus one more: this reading is two folds the Session already maintains and caches, so a projection would re-materialize the same state into a wire schema with its own `stateVersion` for no new authority.

**A new client package beside `ui-session-info`.** Rejected because the new tab reads the same Remote namespace, registers into the same slot, uses the same dictionary, and needs the same inject declaration; a second package would duplicate that wiring and give maintainers two homes for one capability's presentation.

## Consequences

A Session's instruction surface is now one tab away: the whole prompt, every tool with its schema, and a search across both. The reading is deliberately the *last logged* request, so a tool registered after that request appears only once the next request is logged, and the prompt is shown as rendered text rather than as contributing sections — both are stated in the package's Known Limitations. Neither side gained a dependency: the Host payload declares its own JSON union, and the client derives the schema type from it.

The Info tab's DOM order is unchanged, so its existing tests still assert the same six headings, but its markup moved to a grid and its Refresh button moved into a toolbar; any future styling work should treat the grid as the layout contract rather than the previous vertical stack. Verification is the Host service spec (the system-node rule, the catalog mapping, the empty reading, the unavailable Session, the aborted request), the Prompt view and pure-helper specs (including both abort rails of its read and a schema that declares no type), and the unchanged Info spec (blocks, degradation, dispatch).
