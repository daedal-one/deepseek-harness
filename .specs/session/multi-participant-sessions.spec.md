---
id: REQ:session/multi-participant-sessions
type: requirement
status: accepted
level: MUST
summary: Let a Session hold many participants — humans and agents — with per-participant authority, attribution in the log, and a meta-agent that manages other Sessions from durable intentions.
owners: [carlo]
refines: []
categorized_under: []
---

# Multi-participant sessions

## Context

A Session has one implicit author and one main Agent. Nothing in the log says who produced an event, authority is resolved once per Session, and an agent that coordinates other agents does so only as a child Session of one parent. A shared conversation in which several humans, an executor agent, and a coordinating agent each act under their own permissions cannot be expressed.

:::{requirement id="multi-participant-sessions" level="MUST"}
- {#c-envelope} Every Session event MUST name the participant that caused it. The identity MUST be a reference resolved against the participant roster rather than a copy of mutable participant detail. Introducing it MUST bump the Session format version and ship one adjacent migration, preserving the prior generation unchanged and never rewriting it in place.
- {#c-attribution} Model history derived from a shared Session MUST render which participant produced each user-role message. A participant whose roster record is unavailable MUST render as explicitly unattributed and MUST NOT be silently dropped or attributed to another participant.
- {#c-roster} A participant roster MUST be a capability seam with a Service Definition, a durable Service Provider, and Consumers. Registering, removing, and changing a participant MUST publish a post-commit change notification, and joining or leaving a Session MUST be recorded in that Session's log without changing its behaviour for readers that predate the event.
- {#c-authority} Authority MUST be a property of the participant: a principal and a capability set naming the tools it may call and the sandbox mode and approval policy its actions run under. Enforcement MUST occur as an explicit check at the operation that acts, and MUST NOT rely on scoped-context routing as the authority boundary. An unstated capability MUST resolve to the Session default, and an unresolvable participant MUST be refused rather than defaulted.
- {#c-human-claim} Authority MUST NOT be derived from a self-declared human marker on a message. The existing discriminant that an omitted source resolves to a human input MUST NOT be the input to an authority decision, because it lets any caller claim the owner's authority.
- {#c-multi-agent} A shared multi-participant thread MUST NOT require more than one agent to append to a single Session log. Re-keying the agent registry and generalizing the serialized turn and step invariant to several drivers over one log MUST be a separate, explicitly taken decision, because that invariant is what makes the log reconstructable.
- {#c-input} A submitted input MUST name its participant, and admission MUST verify that participant's authority to send to that Session before the input is claimed. Messages pending from several participants MUST each be admitted and attributed to their own author, and MUST NOT reorder a turn's own steps or interleave a second turn into a running one.
- {#c-default} A Session created without participants MUST behave exactly as it does today, with the creating human holding the Session's configured authority. A participant's authority MUST be able to narrow the Session default and MUST NOT silently widen it.
- {#c-manager} A meta-agent MUST be an agent participant whose capability set may cross Sessions, letting it list, create, and address other Sessions under the same authority checks as any participant. It MUST run as a root Session and MUST NOT be a delegated child, because a delegated child cannot request interactive approval or ask a human a question. Its distinguishing state MUST be a durable set of user intentions with priorities, owned outside any single Session, and it MUST record which intention and priority drove each decision it makes.
- {#c-cross-session} Cross-Session creation and steering MUST be granted through named model-facing consumers rather than by reaching a same-process creation call directly. Creating a Session MUST NOT be treated as starting it: work begins only when input is admitted, and a consumer that creates a Session without prompting one MUST report the resulting idle Session instead of implying progress. A durable cross-Session index MUST NOT be model-visible, MUST live in the host-side storage domain rather than any Session log, and MUST be presented as an approximation of liveness because true run state is process-local and does not survive a host restart.
- {#c-retention} Because the runtime provides no Session deletion and committed log generations are immutable, a participant that creates Sessions MUST treat accumulation as the steady state and MUST report retention or capacity rather than assuming it can remove what it created.
- {#c-intentions} An intention MUST be a durable cross-session statement of what a user wants, with a priority, distinct from a same-session goal. A goal MAY cite the intention it serves; completing or abandoning a goal MUST NOT complete or mutate the intention.
- {#c-evidence} Focused tests MUST prove multi-participant attribution in derived model history, unattributed rendering for a missing roster record, adjacent migration of a prior-generation log with the original preserved, divergent authority between two participants in one Session including an attributable refusal, concurrent admitted writers with correct attribution, unchanged single-participant behaviour, refusal of a manager composed as a delegated child, a create-without-prompt consumer reporting an idle Session, a cross-Session index surviving restart while reporting liveness as an approximation, and a manager decision recorded against its intention and priority.
:::
