---
id: REQ:ui/prompt-introspection-tab
type: requirement
status: accepted
level: MUST
summary: Users see the exact system prompt and the complete tool catalog a Session sends to the model, searchable, in a Web conversation view.
owners: [carlo]
refines: []
categorized_under: []
---

# Prompt introspection view

## Context

The shipped Web client's session conversation view exposes Chat, Trajectory, and Info. Info answers what the Session *is*; none of the tabs answers what the model is *told*. The rendered system prompt appears only as a collapsed per-request row inside the transcript, and the assembled tool catalog — every tool's description and argument schema — reaches the client only as request-header detail attached to individual trajectory rows. A user diagnosing instruction drift, an unexpected tool call, or a tool that never appeared has to read the transcript request by request.

The Host already holds both facts in the Session's own folds: the effective system node on its model-visible surface and the latest `request/header` snapshot. A read that states exactly that logged request state is introspection without a second assembly.

:::{requirement id="prompt-introspection-tab" level="MUST"}
- {#c-read} The Host MUST publish one Remote read addressed by session id that returns the rendered system prompt in force for the Session's model-visible surface, the complete tool catalog of its latest request header (each tool's name, description, and argument JSON Schema), and the model route recorded on that header.
- {#c-source} That reading MUST come from the Session's own logged state — the last system node of its derived history and its latest request header — and MUST NOT re-run prompt assembly, re-evaluate provider callbacks, append a Session event, or write anything.
- {#c-degrade} An empty system prompt and an absent tool catalog MUST be reported as stated absences rather than fabricated values, and a Session absent from the live registry MUST answer a stated `session-unavailable` failure.
- {#c-ui} The Web client MUST present the reading as its own locale-owned conversation view tab beside Chat, Trajectory, and Info, rendering the complete prompt text and one entry per tool with that tool's description, declared parameter rows (name, type, required flag, description), and raw argument schema.
- {#c-search} The tab MUST offer one search box that filters the tool entries by tool name, description, or parameter and reports how often the query occurs in the system prompt.
:::
