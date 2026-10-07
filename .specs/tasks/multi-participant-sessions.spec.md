---
id: TASK:session/multi-participant-sessions
type: task
status: accepted
summary: Give Sessions participant identity, a durable roster, per-participant authority, attributed concurrent input, and a cross-session meta-agent over durable intentions.
owners: [carlo]
progress: pending
addresses:
  - REQ:session/multi-participant-sessions#c-envelope
  - REQ:session/multi-participant-sessions#c-attribution
  - REQ:session/multi-participant-sessions#c-roster
  - REQ:session/multi-participant-sessions#c-authority
  - REQ:session/multi-participant-sessions#c-human-claim
  - REQ:session/multi-participant-sessions#c-multi-agent
  - REQ:session/multi-participant-sessions#c-input
  - REQ:session/multi-participant-sessions#c-default
  - REQ:session/multi-participant-sessions#c-manager
  - REQ:session/multi-participant-sessions#c-cross-session
  - REQ:session/multi-participant-sessions#c-retention
  - REQ:session/multi-participant-sessions#c-intentions
  - REQ:session/multi-participant-sessions#c-evidence
blocked_by: []
labels: [session, participants, permissions, daedal]
assignee: carlo
---

# Multi-participant sessions

## Scope

Deliver in the layers the [multi-participant Agent Note](../../.agents/notes/proposed/architecture/2026-10-06-multi-participant-sessions.md) describes, each independently landable.

First the log: add the acting-participant reference to the [`SessionEvent`](../../packages/core/session/src/types.ts) envelope, bump [`SESSION_FORMAT_VERSION`](../../packages/core/session/src/types.ts) to 4, and ship one adjacent `v3 -> v4` migration that preserves the prior generation unchanged. Render attribution in derived model history, with a missing roster record rendering as explicitly unattributed.

Then the roster: add the `ctx.participants` capability seam with a durable provider, post-commit change notification, and `session/participant-joined` / `session/participant-left` events. Then authority: a principal plus a capability set per participant, enforced at the acting operation and defaulting to the Session default. Then input: attributed submission with an authority check at admission and arrival-order admission of several writers.

Finally the manager: a root-session agent participant whose capability set may cross Sessions, plus the two new model-facing consumers it needs (a Session inventory and a create-and-prompt), a `ctx.intentions` service holding durable user intentions and priorities distinct from `ctx.goals`, and a host-side `ctx.storageDomain` index for cross-Session bookkeeping that is explicitly an approximation of liveness. The manager must be a root Session, never a delegated child, because a delegated child cannot obtain interactive approval or ask a human a question.

Maintenance authority for the manager is specified separately by [harness self-maintenance](../../.specs/sandbox/harness-self-maintenance.spec.md) and is not implemented here.

Do not add authentication, accounts, or a network authorization boundary. Participants stay inside one trusted harness home; the roster is the seam an authentication provider attaches to later. Do not add Session deletion, and do not change single-participant behavior.

## Acceptance

A `v3` log opens under the new runtime through the adjacent migration, the original generation is byte-identical afterwards, and a `v4` log is refused by a reader that predates it rather than silently misread. A shared Session's derived model history names who said what, and a removed participant's earlier messages render as unattributed rather than being dropped or reassigned.

Two participants in one Session can hold divergent capability sets: one is refused a tool the other may call, and the refusal is attributable to the refused participant. Two humans with messages pending at once are both admitted, each attributed to its own author, without reordering a turn's steps or interleaving a second turn.

A Session created without participants produces the same events and model requests as before this change. A meta-agent participant lists, creates, and addresses Sessions under the same authority checks as any participant, and each decision it records names the intention and priority behind it. Completing a goal leaves its intention unchanged.

## Verification

Focused unit tests cover envelope attribution, attribution rendering including the missing-record case, the adjacent migration with prior-generation preservation and a future-version refusal, divergent authority with an attributable refusal, concurrent admitted writers with correct attribution, unchanged single-participant behavior, and manager decisions recorded against intentions and priorities.

Keyless recorded-session scenarios pin the shared-thread transcript and the migrated-log replay. Both SDK expected outputs are updated in the same change because the envelope and session lifecycle are projected by each.

`pnpm run typecheck`, focused `pnpm run test`, `pnpm run test:snapshot`, `pnpm run lint`, `pnpm run test:coverage` for the touched packages, and `pnpm run doc-sync`. `spec lint` is unavailable in this environment; the spec files are validated by inspection.
