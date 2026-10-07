# Agent Note: Multi-participant sessions

Status: proposed

## Problem

A Session today has exactly one implicit author. The [`SessionEvent`](../../../../packages/core/session/src/types.ts) envelope carries `type`, `seq`, `time`, `data`, and surface metadata, and nothing else; [`UserMessage`](../../../../packages/llm/llm/src/message.ts) has no sender. Every `user/message` in the log is therefore indistinguishable from every other, whoever or whatever produced it.

The rest of the runtime agrees with that envelope. Approval policy is resolved from a session-scoped permission preset (one sandbox mode plus one approval policy for the whole Session), identity is one anonymous per-harness-home UUID used only to correlate telemetry, and a Session has exactly one main Agent. Agents that "collaborate" today do so as *child Sessions*: a subagent is a separate log with a delegation depth and a parent pointer, not a co-participant in the parent's conversation.

That shape cannot express what users now want: a shared thread that a group works in together, where one or more humans, an executor agent, and a reviewing or coordinating agent all read the same conversation and each acts under its own permission set. The direction is set by Delta ([delta.dev](https://delta.dev), [Zed's introduction](https://zed.dev/blog/introducing-delta)), where a thread is shared with invited participants, each participant holds their own copy of the work, and agents work from the same original conversation and decisions as the humans.

Three concrete product requirements fail on the current envelope:

1. A model reading a shared conversation cannot tell who said what, so it cannot weigh a maintainer's instruction differently from a drive-by observer's, and it cannot be told "only act on requests from the owner".
2. Authority cannot be per-participant. Elevating one participant's sandbox or approval policy today would elevate the Session.
3. A meta-agent that manages *other* sessions has no durable, shared place to keep the goals and user intentions it prioritizes between, other than its own transcript.

## Proposal

Introduce **participants** as a first-class, durable concept, and make the Session log the place authorship lives. The work is layered so each layer is independently landable and useful.

### Layer 1 — Participant identity in the Session log

Add an `actor` reference to the `SessionEvent` envelope, naming the participant that caused the event. This is an envelope change, so it bumps [`SESSION_FORMAT_VERSION`](../../../../packages/core/session/src/types.ts) from 3 to 4 and ships one adjacent `v3 -> v4` migration package, following the released-migration rules and the existing [`session-format-v2-to-v3`](../../../../packages/session/session-format-v2-to-v3/README.md) precedent: the prior generation is preserved unchanged and a version-named successor is published beside it. The migration carries one honest default, since a `v3` event records no actor: derived history for a migrated log attributes its existing messages to the Session's implicit single author, and does not invent participants that never existed.

The envelope carries an id, not a copy of the participant record. A participant is mutable (a display name changes, a capability set changes); the log records *who acted*, and the roster resolves *what that participant currently is*. Reconstruction stays exact because the identity, not the mutable detail, is what the model needs.

The projection into model history changes with it. `deriveMessages()` currently emits every user-role message identically; with several participants, the model must be able to tell them apart, so each projected user message gains a rendered attribution derived from the logged actor and the roster. This is a model-visible input, so it must be reconstructable from the log — which it is, because the actor is in the envelope and the roster is durable. Attribution rendering is owned by the projection, and a participant whose record is missing renders as an explicitly unattributed actor rather than being silently dropped.

### Layer 2 — The participant roster

A new capability seam, `ctx.participants`, in the established Service Definition / Service Provider / Consumer shape:

- **Service Definition** declares the roster: register, look up, list, and a post-commit change event for readers to converge on.
- **Service Provider** persists it. The reference provider stores the roster under the harness home beside settings, so it survives restart and is not a property of any one Session.
- **Consumers** are the system-prompt section that tells the model who is present, the tools that invite or remove a participant, and the projection that renders attribution.

Joining a Session is recorded in that Session's log, because it is a fact the conversation depends on: a `session/participant-joined` and `session/participant-left` event, both ordinary event types that do not bump the format version. A joined participant is durable for that Session; removing one does not erase what it already said.

### Layer 3 — Per-participant authority

Authority becomes a property of the participant, resolved at the operation that acts, matching the project principle that policy decisions are enforced where the action happens.

Each participant carries a **principal** and a **capability set**. The capability set names the tools the participant may call, and the sandbox mode and approval policy under which its actions run.

Enforcement is an explicit check at the acting operation, and *not* a reliance on scoped contexts. The temptation is to say that an agent participant "runs in its own scope, therefore it is isolated", but [`dsh-scope`](../../../../packages/core/scope/README.md) states plainly that it routes trusted same-process plugins and is not a sandbox or an authority boundary. Scoping decides which registration a call resolves to; it must not be asked to decide whether a call is permitted. The permission check reads the participant's capability set at the operation, exactly as the existing session-scoped preset is consulted today.

For a human participant, the same capability set is consulted when their input is admitted and when a tool call is attributed to their request. A human participant has no agent scope, so the check happens at input admission and at the approval seam.

The existing session-scoped permission preset remains the Session's *default* authority: a Session created without participants behaves exactly as it does today, with the creating human holding the Session default. Participants narrow authority; they do not silently widen it.

One existing weakness must not be inherited. Human-ness is currently *self-declared and trusted*: the goal tools treat `source.kind === 'user'` as host-attested human input, and an omitted source silently resolves to `user`. A participant model that keys authority off that discriminant would let any caller claim to be the human owner. The participant reference replaces the discriminant as the authority input, and a message whose participant cannot be resolved by the admission path is refused rather than defaulted to the human.

### Layer 4 — Attributed input and concurrent writers

An input submitted to a Session names the participant that submitted it. The driver's inbox currently claims the next input without attribution; the admission path resolves the actor, checks that participant's capability set permits sending to this Session, and stamps the resulting `user/message` with the actor.

Concurrent writers are admitted, not serialized away. Several participants may have messages pending at once; each is admitted in arrival order and attributed to its own author. The turn lifecycle is unchanged — one turn still owns one step at a time — because concurrency belongs to *who may speak*, not to how the loop runs a step.

### Layer 5 — The meta-agent as a participant

The meta-agent, or harness manager, is an agent participant with a capability set that crosses Sessions: it may list Sessions, create them, and address their participants, subject to the same authority checks as anyone else. It is not a second application and owns no privileged core.

#### The manager must be a root Session, not a delegated child

This is a hard constraint, not a preference. Every in-process delegated child is pinned to `approvalPolicy: 'never'` ([`child-agent.ts`](../../../../packages/subagent/subagent/src/child-agent.ts)), so a manager running as a subagent can never obtain an `allowed-once` decision, and `ask_user_question` refuses a delegated caller outright ([`ctx.userQuestions`](../../../../packages/interaction/user-questions/src/index.ts) rejects `DELEGATED_CALLER`). A manager implemented as one more named role beside `orchestrator` would therefore be unable to ask a human anything or to obtain approval for the maintenance work it exists to do. The manager is a root Session; only its *workers* are delegated children.

#### Cross-Session authority is new plumbing

No model-facing tool creates a root Session today. [`ctx.agents.create`](../../../../packages/core/agent/src/index.ts) is a trusted same-process call whose callers are the webhook runtime, ACP, the SDK server, the headless bundle, the in-process subagent driver, and session-controller's fork — all of them plumbing, none of them a tool. Delegation tools reach only children, `send_message` reaches depth-1 children of the caller, `interrupt_agent` reaches live descendants, and job reads and kills are owner-fenced. So the manager needs new consumers — a Session-inventory tool and a Session-create-and-prompt tool — and those consumers are what its cross-Session capability set actually grants.

Two behaviors of the existing primitives shape those consumers:

- **Creating a Session does not start it.** `ctx.agents.create` publishes the Session and its Agent; the driver runs only when input is admitted. Every creation is a create-then-prompt pair, and a consumer that creates without prompting yields an idle Session and no work.
- **Liveness is host-process-local.** True run state is `Agent.status`, published as `api-session/status`. Projections and control baselines do not survive a Host restart. A durable cross-Session index is therefore an *approximation* of liveness, and it must be described and named as one rather than presented as ground truth.

#### Where the manager's state lives

Model-visible state goes in the manager's own Session log, because the project rule is that anything reaching a model request is reconstructable from it. That covers the intentions the manager reads and the decisions it records.

**Intentions** are a durable, cross-Session set of user intentions with their relative priority, owned by a new `ctx.intentions` service and event-sourced in the manager's log with a projection, following the pattern `ctx.goals` and Agent Teams already use. The manager reads intentions to decide what to run next and records what it decided and why.

Intentions and goals are deliberately different things. A goal is a same-session objective with continuation rounds, owned by [`ctx.goals`](../../../../packages/goal/goal/src/index.ts) — one per Session, created through `create_goal` and refused with `GOAL_ALREADY_EXISTS` if a non-complete goal exists. An intention is a durable, cross-Session statement of what the user wants, with a priority, owned by `ctx.intentions`. Nothing in the runtime has a priority or ordering field today. A goal may cite the intention it serves; completing a goal does not complete the intention.

The **cross-Session index** — which Sessions exist, which the manager owns, what it last observed about each — is process-wide bookkeeping that must not be model-visible, so it belongs in a host-side storage domain ([`ctx.storageDomain`](../../../../packages/storage/storage-domain/src/index.ts)) beside the workspace and projection-cache records, not in any Session log and not in a file of our own invention.

#### Accumulation, not deletion

There is no Session deletion anywhere in the runtime: no Remote, no persistence removal, and committed log generations are immutable. Archiving only removes a Session from workspace grouping. A manager that creates Sessions must therefore treat accumulation as the steady state and plan capacity, retention, and reporting around it, rather than assuming it can clean up after itself.

### Layer 6 — Self-maintenance

The manager's maintenance authority splits by what it can honestly reach, and the boundary is sharper than it first appears.

**In-session maintenance** is ordinary authorized work: running the repository's gates, inspecting the composed configuration, inspecting the live plugin tree, installing or updating a plugin, and reloading a patch on a live profile. Three facts about those surfaces shape how the manager may use them.

Live runtime introspection is `packages/extensions`, not a `self-modification` package, and its tools (`cordis_inspect_list`, `cordis_inspect_query`, `cordis_inspect_self`, `cordis_define`, `cordis_run`, `cordis_stop`, `cordis_undefine`) are mounted by **no shipped bundle**. A manager that expects to inspect its own runtime must first have that tool row added to its profile. Its dynamic packages are also deliberately ephemeral: definitions live in process memory, never touch disk, and cannot remove loader, configured, or installed plugins. Durable change is therefore the ordinary development path — edit, gate, commit — followed by a host handoff to activate.

The plugin install path is a `pnpm` forwarder with no confirmation prompt, no registry allowlist, and no signature verification. An automated loop that shells out to it is acting with bash-equivalent trust on the installation, so the manager must reach it through an explicit authorization decision rather than as a routine self-service action.

There is no `dsh doctor`, no diagnostics report, and no health status API; the invariants registry throws on violation but reports nothing. A maintenance loop must therefore *synthesize* health from what it can observe — the gates, the composed configuration dump, and the plugin inventory — and must present that synthesis as evidence it gathered, not as a verdict a health service produced.

**Host maintenance** — updating or restarting the harness process that hosts this Session — cannot be performed from inside the Session's own execution world. There is no `dsh upgrade`, `dsh update`, or self-update command, no runtime check for a newer release, no way for a tool to switch the running launch profile, and the architecture assigns build activation and restart to a service supervisor outside the harness. It goes through the existing human-confirmed handoff: the manager prepares the change, verifies it, and requests a host Session that performs the activation.

Automating this end to end means automating preparation, verification, and the *request*. Two parts stay outside the manager: the human confirmation at the handoff boundary, and the host-side activation machinery, which does not exist in this repository today and cannot be built from inside an isolated workspace. Making that confirmation a one-click review of an already-verified change — revision, checks already run, remaining host steps, rollback position — is the part of "end to end" that is actually buildable here; the rest is host work that must be handed off.

## The multi-agent fork

This is the single largest cost in the proposal, and it deserves to be decided deliberately rather than discovered during implementation.

[`AgentRegistry`](../../../../packages/core/agent/src/index.ts) is keyed by `SessionId` alone, and its `enter` refuses an agent whose id differs from its session's id. The per-session inbox projection key is singular, and the [session invariant](../../../../packages/core/session/src/invariant.ts) enforces one serialized turn and step machine per log. Every one of those assumes exactly one agent per Session.

So **"several agents in one shared conversation" is not a feature on top of the current model — it is a second agent identity per log.** There are two honest ways to get a shared thread, and they differ by roughly an order of magnitude in cost.

**Option A — one log, several agents.** Re-key the registry off `SessionId`, give each agent its own inbox, and generalize the turn/step machine to arbitrate several drivers over one log. This delivers the most faithful reading of a shared conversation: one transcript, agents and humans interleaved in it. It also invalidates the invariants the Session design rests on — the serialized turn machine is what makes the log reconstructable — and it changes the meaning of `agent.id`, which is consumed by the registry, Typert's `wire: 'agentId'`, session-controller's ownership fence, and the subagent lineage checks.

**Option B — a thread over Sessions.** Keep one agent per Session and each log exactly as it is. A *thread* is a durable grouping of Sessions that share one participant roster, presented as one conversation. Humans participate in the thread; each agent contributes through its own Session; the client composes the thread's transcript from its members. Every existing invariant survives untouched, the format bump is still required for participant attribution, and the cost is confined to the roster, a thread grouping, and the client's transcript composition.

**Recommendation: Option B first.** It delivers the product shape the user asked for — a group where humans, an executor agent, and a manager interact, each with their own permissions — without redefining what a Session is. Option A becomes a later change that swaps the thread's backing from several logs to one, and the participant roster, authority model, and thread UI all carry over, because they are described in terms of participants and threads rather than in terms of logs. Deciding this now matters because Option A would make the format change far larger: attribution would have to name which of several agents acted on every event, not just which human.

## Alternatives considered

**A meta-agent as a separate always-on application.** Rejected as the primary shape. It would duplicate Session creation, admission, and logging outside the plugin tree, and the project's rule is that there is no privileged core to patch — a manager with capabilities nobody else can hold is exactly that. The manager is a participant with a large capability set, so every power it has is a power the deployment can inspect, scope, or remove.

**Building on the experimental Agent Teams package.** Agent Teams already layers a roster, task board, and mailbox over continuable subagents, and it is the closest existing thing to this proposal. It is not the base because its roster is a *coordination* roster scoped to one parent's delegation tree, whereas this proposal needs participants of a Session that can include humans and agents that did not spawn from one another. The task board and mailbox remain the right vocabulary for agent-to-agent work and should be reused rather than reinvented; the roster is the part that must move to the Session.

**Participant metadata in a sidecar store instead of the event envelope.** Rejected. It avoids the format bump, but it breaks the invariant the whole Session design rests on: anything reaching a model request must be reconstructable from the log. Attribution reaches every model request in a shared thread, so it belongs in the log, and a sidecar would make a Session's model history depend on mutable state outside it.

**Attribution on the message source instead of the envelope.** This is the cheapest alternative and it is nearly right. `MessageSourceMap` already carries senders: `agent-message` and `subagent-settled` name a `senderSessionId`, and the experimental team mailbox's `team-message` carries a `senderId` and `senderName`. Extending the user source with a participant reference, or adding a participant-bearing source kind, would deliver rendered attribution in model history with **no format bump at all**, because provenance is already per-message and `user/message` is the only surface where a human appears.

It loses on everything that is not a message. A tool call, a cancellation, a turn boundary, and an approval decision are events with no source field, so "who caused this" would be answerable only for messages, and a refused tool call could not be attributed to the participant whose authority refused it — which is precisely the audit the authority model exists to provide. It also cannot express a participant acting without speaking. The envelope is the right home; the source extension remains the right *fallback* if the format bump is deferred, and the two are compatible, since a source-level participant reference is a strict subset of an envelope-level one.

**Comments and anchors as a separate document store.** Deferred, not rejected in principle. Delta's anchoring of comments to arbitrary text and code lines is a large capability in its own right and is not required for participants to work. Anchored comments are a follow-on that should attach to the same actor vocabulary once it exists.

**Full multi-user authentication first.** Rejected as the first step. Real multi-user needs accounts, authentication, and an authorization boundary, and the harness today has only an anonymous per-home identifier used for telemetry correlation. Introducing an authentication boundary and a participant model in one change would make neither reviewable. The first delivery keeps participants inside one trusted harness home — local humans and agents — and treats the roster as the seam an authentication provider attaches to later.

**Envelope-level actor as a full participant record.** Rejected. Embedding the record would freeze a mutable thing into an immutable log, and every later rename or authority change would either be wrong in history or require rewriting it.

## Acceptance criteria

- A Session can hold more than one participant, and every event in its log names the participant that caused it.
- Model history derived from a shared Session renders who said what, and a participant whose roster record is gone renders as unattributed rather than disappearing.
- A `v3` log opens under the new runtime through the adjacent migration, and the prior generation is preserved unchanged.
- Two participants with different capability sets act in the same Session: one may call a tool the other cannot, and the refusal is attributable.
- Two humans may have messages pending in one Session at once; both are admitted and each is attributed to its own author.
- A message that merely claims to be human does not receive the owner's authority.
- A Session created without participants behaves exactly as it does today.
- A shared thread delivers a group conversation without requiring more than one agent per Session log.
- A meta-agent participant reads durable intentions, creates a Session, and records which intention and priority drove the decision.
- In-session maintenance actions are authorized and auditable; a host-level update is prepared and verified in-session and activated only through the human-confirmed handoff.

## Risks

**The format bump is the sharp edge.** Raising [`SESSION_FORMAT_VERSION`](../../../../packages/core/session/src/types.ts) to 4 touches every persistence, projection, fork, and replay path, and a missed bump makes older runtimes read new logs wrongly and silently. The migration must be written to the released-migration rules, with the prior generation preserved and both the adjacent migration and the current fast path tested.

**Authority is a security boundary and must fail closed.** A participant model that defaults an unstated capability to *permitted* would widen access for every existing Session. Unstated authority resolves to the Session default, and an unresolvable participant resolves to refusal, never to the Session default.

**The existing human discriminant is not an authority input.** `source.kind === 'user'` is self-declared, and an omitted source silently resolves to `user`; the goal tools already treat it as host-attested human input. If the participant model reads authority from it, every caller can claim to be the owner. The participant reference must displace it as the authority input, and migration must not turn an unset actor into an owner.

**Attribution rendering costs tokens on every request.** Adding a participant name to every user message in a long shared thread is a permanent prefix cost. The rendering must be compact and must not invalidate the cached prefix when an unrelated participant's display name changes.

**Concurrency in the inbox is a correctness risk, not just a feature.** Admitting several writers must not reorder a turn's own steps or let a second turn interleave into a running one. Settlement ordering is the invariant to pin with tests.

**Scope.** This is the largest change proposed for this codebase to date. The layering exists so each layer can land and be reviewed alone; the format bump plus the roster plus attribution is the minimum coherent first delivery, and per-participant authority, concurrency, and the meta-agent follow.
