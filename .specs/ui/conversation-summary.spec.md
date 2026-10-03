---
id: REQ:ui/conversation-summary
type: requirement
status: accepted
level: MUST
summary: Users see a short durable summary of what a conversation is about and what has been done in it, in the Web Info view and in the conversations sidebar.
owners: [carlo]
refines: []
categorized_under: []
---

# Conversation summary

## Context

A Session's durable surface for "what is this conversation" is one short title. The title is enough to pick a row from a list but not enough to recall what happened inside it, and the Web client has no per-Session account of progress: the Info view lists identity, workspace, environment, policy, and spend, while an operator has to open the transcript and read it to learn what the Session is about or what it has already done. The sidebar hover card for a Session row shows its title, recency, and live status, so an operator scanning many Sessions cannot tell two similarly named Sessions apart.

A short model-written summary of the conversation — its topic and what has been done so far — is durable Session data like the title, so every client reads one accepted value instead of re-deriving it.

:::{requirement id="conversation-summary" level="MUST"}
- {#c-durable} The Host MUST record each accepted conversation summary as one durable Session event carrying the summary text, the exact source seqs it was generated from, and the model route that produced it, and MUST publish the latest accepted summary as the Session projection key `summary` so clients read it from the ordinary list and projection paths.
- {#c-cadence} Summary generation MUST run after a Turn closes, outside that Turn's critical path, MUST supersede any older in-flight generation for the same Session, and MUST hold at most one in-flight request per Session.
- {#c-bounded} Generation MUST be bounded by deployment-configured input, output, and end-to-end time limits; an input exceeding its byte budget, or output that is empty, non-text, over budget, or terminally failed, MUST be rejected rather than truncated or accepted.
- {#c-request} Every auxiliary model request MUST be recorded as a durable Session event before dispatch, carrying the exact route, system prompt, messages, and output-token cap, so the request is reconstructable from the log.
- {#c-degrade} A rejected, failed, aborted, or superseded generation MUST publish no summary and MUST NOT replace a previously accepted one; a Session without an accepted summary MUST be reported as an explicit absence, never a fabricated value.
- {#c-info} The Web client MUST present the Session's summary in the existing **Info** conversation view, with the stated absence when the Session has none.
- {#c-sidebar} Every conversations-sidebar Session hover card MUST present the Session's summary, with the stated absence when the Session has none; the row itself MUST NOT change.
:::
