---
id: TASK:session/session-peer-communication
type: task
status: accepted
summary: Give any two Sessions durable, attributed, authority-checked peer addressing, with the remote boundary deferred.
owners: [carlo]
progress: pending
addresses:
  - REQ:session/session-peer-communication#c-addressing
  - REQ:session/session-peer-communication#c-delivery
  - REQ:session/session-peer-communication#c-attribution
  - REQ:session/session-peer-communication#c-authority
  - REQ:session/session-peer-communication#c-transport-neutral
  - REQ:session/session-peer-communication#c-liveness
  - REQ:session/session-peer-communication#c-evidence
blocked_by:
  - TASK:session/multi-participant-sessions
labels: [session, peer, permissions]
assignee: carlo
---

# Session peer communication

## Scope

Implement peer addressing on top of the participant and authority model, because a peer message is the first capability that acts across Sessions and its sender must be a resolvable participant before it can be authorized or attributed. This task does not define participants, authority, or the session format change; it consumes them.

Add a durable Session inventory that names addressable Sessions and outlives any one process, and build addressing on it rather than on live-process membership. Reuse the mailbox and Steer vocabulary already established for agent-to-agent work rather than inventing a second one: queue durably before reporting acceptance, deliver at most once, and let a target that is not loaded receive its queued message when it next runs. Give peer messages their own durable sender attribution so they cannot satisfy the host-attested human input check, and check the sender's and target's capability sets at the operation that delivers, failing closed and reporting an attributed refusal.

Delivery must respect single-writer ownership of a Session log: when the target's log is owned by another process, the message routes to that owner instead of being appended by the sender. Presence is an approximation of liveness and must be presented as one.

Do not introduce a remote boundary here. Transport is deliberately unspecified: local delivery carries the requirement alone, and choosing how remote peers are identified, authenticated, and reached is a separate decision with its own spec. Do not add accounts, authentication, or a network authorization boundary, and do not change behavior for single-participant Sessions or for parent/child delegation.

## Acceptance

Two Sessions that are neither parent, child, nor manager of each other address each other directly: the message is recorded once in the target's log, attributed to its sender, and the sender observes acceptance only after it is durable. A message addressed to a Session that is not loaded is delivered when that Session next runs and is not delivered a second time when delivery is retried. A peer message the sender's capability set does not permit is refused with the refusal attributed to the sender, and no peer message satisfies the host-attested human input check. A target whose log is owned by another process receives the message through that owner. Presence reports a peer as absent without making it unaddressable. Single-participant Sessions and parent/child delegation behave exactly as they did before this change.

## Verification

Focused unit tests cover direct addressing between unrelated Sessions, durable queue-and-deliver for an unloaded target, at-most-once delivery under retry, attributed refusal of an unauthorized peer message, a peer message that does not satisfy the host-human-input check, cross-process delivery routed through the log's owner, and unchanged single-participant and delegation behavior.

Keyless recorded-session scenarios pin the peer transcript rendering and the durable attribution of a delivered peer message. Both SDK expected outputs are updated in the same change when the envelope or session lifecycle changes.

`pnpm run typecheck`, focused `pnpm run test`, `pnpm run test:snapshot`, `pnpm run lint`, `pnpm run test:coverage` for the touched packages, and `pnpm run doc-sync`. `pnpm run spec-lint` validates this tree against the `forge-spec-v0.7.0` baseline declared in `.specs/_config.toml`.
