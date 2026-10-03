# Agent Note: A durable conversation summary projected into the Web Info view and the sidebar hover

Status: implemented

## Problem

A Session's only durable account of *what it is* was its title: a handful of words chosen to disambiguate a row. The title is enough to pick a conversation out of a list and nothing more. An operator returning to a Session — or scanning a sidebar of similarly named Sessions — could not see what the conversation was about or what had already been done in it without opening the transcript and reading it. The Info view, which had just become the session's general information surface, listed identity, Workspace, environment, policy, and spend, but said nothing about the conversation itself.

The pieces to answer that question already existed separately: the Session log holds every prompt, every visible Assistant reply, and every Tool call, and the repository already had a working pattern for turning bounded Session material into a small piece of durable, user-facing text with an auxiliary model call (`session-title`, `session-activity-summary-llm`). What was missing was one durable, client-readable value that means "this conversation, in a few sentences".

## Decision

Conversation summaries ship as one new Host plugin, `@deepseek-ai/dsh-session-summary-llm` at `packages/session/session-summary-llm`, driven by the [conversation-summary intent](../../../../.specs/ui/conversation-summary.spec.md) and its [accepted task](../../../../.specs/tasks/conversation-summary.spec.md).

**One closed Turn is one revision.** The plugin listens to committed `session/event` records. A `turn/end` collects that Turn's human `user/message` text, its visible `assistant/message` text, and its `tool/call` names, adds the previously accepted summary, and sends one bounded auxiliary request. A `turn/start` aborts any in-flight revision, and a `turn/end` for a different Turn supersedes the older one rather than queueing behind it, so at most one request per Session is live and the newest Turn always wins. Nothing runs on the main Turn's critical path.

**The auxiliary request is durable before it is dispatched, and only accepted text becomes state.** Each request is appended as `session/summary-llm-request` carrying the exact route, system prompt, messages, output-token cap, reasoning effort, and source seqs; an accepted result appends `session/summary` carrying the normalized text, the folded source seqs, the highest covered seq, and the route. Rejection — empty or non-text output, an over-budget reply, a non-`stop` finish, a frame that cannot fit `maxInputBytes`, supersession, or disposal — publishes nothing and leaves the previous accepted summary standing. The projection is a pure fold over that one event, so a replay rebuilds the same value.

**Client-wire, not client-derived.** The plugin registers the `summary` projection key with a `string | null` wire view: the latest accepted text, or `null`. That is what puts the summary on the ordinary Session-list path — the same one that already carries `title` and `schedule` — so the Workspace browser reads `projectionValues.summary` for every row it renders. The Host `sessionInfo.read` snapshot gains a top-level `summary` field read from the same projection cut as its other keys, so the Info view shows the same value without a second round trip.

**Absence is a state, not a fallback.** A Session with no closed Turn, or one whose only revision failed, projects `null`. The plugin deliberately has no deterministic fallback: the Info view and the hover card each render locale-owned "no summary yet" copy rather than inventing a plausible sentence from log fragments.

**One package, not a service plus providers.** Unlike `session-title`, there is exactly one sensible way to produce this value today (an auxiliary model call), and no client needs to swap it. The package therefore registers its own projection, events, cadence, and request policy in the shape `session-activity-summary-llm` already established, instead of publishing a `ctx.sessionSummary` seam with a single provider.

**The auxiliary call is a distinct purpose.** `GenerateOptions.purpose` gains `'session-summary'`, and the DeepSeek adapter disables thinking for it, so the small output budget is reserved for visible summary text rather than hidden reasoning.

## Alternatives considered

**Deriving the summary from existing projections with no model call.** The turn outline already carries a prompt preview and a settled-response preview per Turn, and the list projection already carries the title. Composing those would have been free, always available, and immune to generation failures. It was rejected because the result is a set of previews, not an account: it cannot state what was done in a Turn whose reply was mostly Tool calls, cannot compress twenty Turns into a few sentences, and would put a second, differently-shaped "summary" next to the model-written one already accepted for titles. The requirement is a few sentences about topic and progress, which is a generation task.

**Generating on demand when the Info view opens.** This would have paid only for summaries a user actually looked at, and would have kept cold Sessions free. It was rejected because the sidebar hover needs the same value for every rendered row: an on-demand read would either block the hover on a model call or show nothing until the user opened each Session, which is exactly the situation the hover exists to avoid.

**Extending the existing `session-activity-summary-llm` plugin.** It already writes bounded progress text, so reusing it looked attractive. It was rejected because its unit is a batch of four to six operations and its output is at most three live status lines scoped to one Turn — a latest-wins progress ticker rendered inside Chat, not a cumulative account of a conversation. Growing it into both would have made one event stream carry two different lifetimes and two different consumers.

**A separate capability package with a provider registry, mirroring `session-title`.** This is the repository's template for model-backed Session text, and it is what the change was specified to mirror. It was rejected on the capability-seam rule: the roles do not evolve independently here. There is one generation strategy, no user-override path, and no second provider in sight; publishing a service with a single registration would be a seam without a second side. `session-activity-summary-llm` is the precedent for the shape that shipped.

**A dedicated `summary` field on the existing `sessionListMetadata` projection.** This would have avoided a new projection key. It was rejected because `sessionListMetadata` folds list-rendering facts (`blank`, `lastPromptAt`) and is registered by the list owner, not by the plugin that produces the summary; writing a summary into it would give one projection two owners with different state versions and would make the summary invisible to any client that reads the projection registry directly.

## Consequences

A Session now carries a short durable account of its topic and progress that every client reads from one place, and the Web client shows it in the Info view and in the sidebar hover card without a new Remote, a new request, or a new client store. The sidebar hover gains a line for every non-blank row, which costs vertical space in the card and makes a Session's summary visible while merely browsing.

The cost is one auxiliary model request per closed Turn in the shipped Web composition, on a 16 KiB input and 200-token output ceiling, plus up to 1200 bytes of summary text per accepted revision in the Session log. Because each revision folds the previous accepted summary plus one Turn's records, the request stays bounded as a conversation grows, but the projected text can lag the conversation by a Turn while a revision is in flight or after a failure.

The input trimming rule is the sharpest edge: when a Turn's records do not fit the input budget, the oldest entries of *that Turn* are dropped and the request proceeds, so a very long Turn's summary is written from its tail. A frame that cannot fit even one entry is a failure that publishes nothing, rather than a truncated request.

Adding two required-on-read Session events is a durable-format change: a build that does not know `session/summary-llm-request` or `session/summary` refuses a log containing them, per the ordinary required-on-read rule. The new `purpose` union member is a pre-stable public API change that every consumer of `GenerateOptions` and `DeepSeekLlmApiExtensionRequest` must pick up; the generated Cordis catalogs carry the widened union.

No snapshot case is committed with this change. The keyless recorded-session lanes select model responses through `@deepseek-ai/dsh-llm-replay`, and this checkout's workspace links are incomplete — the SDK profile cannot resolve the replay package, so the lane fails on every case with `no adapter registered for provider "deepseek-official"` before reaching any assertion. The case still needs to be recorded by the owner through the shipped snapshot scripts, and the plugin's own keyless suite covers the request, acceptance, supersession, rejection, trimming, and disposal paths until then.
