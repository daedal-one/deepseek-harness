---
id: REQ:session/session-peer-communication
type: requirement
status: accepted
level: MUST
summary: Any two Sessions address each other durably, attributed and authority-checked, with the transport left as an explicit later decision.
owners: [carlo]
refines: [REQ:session/multi-participant-sessions]
categorized_under: []
---

# Session peer communication

## Context

Sessions cannot address each other today. Delivery is fenced by delegation adjacency: the subagent service accepts only a durable direct-parent or direct-child session id, and the experimental team mailbox validates membership against one root Session's delegation tree. The generic delivery primitive carries no authorization at all — `Agent.send` inserts into a target inbox and wakes its driver, and the initiator scope is documented as attribution rather than authorization. Meanwhile the goal tools treat an omitted message source plus root-Agent membership as host-attested human input, so an unfenced cross-Session send is a privilege-escalation path rather than a missing convenience.

Nothing in the runtime names a peer, and nothing durable records that one Session addressed another. Presence is process-local, and a Session's log has exactly one writer at a time, guarded by a cross-process write lease. This requirement pins the observable behavior that peer communication must have. It deliberately does not choose a transport: local delivery and any future remote delivery must be indistinguishable to a Session.

:::{requirement id="session-peer-communication" level="MUST"}
- {#c-addressing} Any two Sessions in one harness home MUST be able to address each other directly, whether or not either is the other's parent, child, or manager. Addressing MUST resolve against a durable inventory of Sessions rather than process-local liveness, and MUST name a stable Session identity rather than a display name, so a peer that is not currently loaded remains addressable rather than absent.
- {#c-delivery} A peer message MUST be durable before the sender is told it was accepted, MUST be delivered at most once, and MUST NOT be lost. A message accepted for a target that is not loaded MUST be delivered when that target next runs. Delivery into a Session whose log another process owns MUST route to the owning process instead of appending to that log from a second writer.
- {#c-attribution} A delivered peer message MUST carry durable sender attribution that survives reload and is reconstructable from the target's log. It MUST NOT be rendered as unattributed, MUST NOT be attributed to another participant, and MUST NOT be treated as host-attested human input.
- {#c-authority} Authority MUST be checked at the operation that delivers and MUST fail closed when the sender's or the target's capability set does not permit the message. Addressing MUST NOT itself widen authority, and a refusal MUST be reported to the sender and attributed to the refused sender.
- {#c-transport-neutral} This requirement constrains observable behavior, not transport. Local delivery and any future remote delivery MUST share one message vocabulary and one attribution model, and no Session-visible behavior, log record, or model-visible rendering may depend on which transport carried a message. Local peer communication MUST NOT require a network boundary, a network service, or an account system. Introducing a remote boundary, and choosing how peers there are identified and authenticated, MUST be a separate and explicitly taken decision.
- {#c-liveness} Presence MUST be presented as an approximation of liveness, never as ground truth, because true run state is process-local and does not survive a host restart. A peer absent from presence MUST remain addressable and MUST NOT be reported as deleted or unreachable.
- {#c-evidence} Focused tests MUST prove direct addressing between two Sessions that are neither parent, child, nor manager of each other; durable queued delivery to a target that is not loaded; at-most-once delivery under retry; an attributed refusal of a peer message the sender's capability set does not permit; a peer message that does not satisfy the host-attested human input check; a target whose log is owned by another process receiving the message through that owner; and unchanged behavior for single-participant Sessions and for parent/child delegation.
:::
