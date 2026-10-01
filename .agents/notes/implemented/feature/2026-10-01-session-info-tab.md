# Agent Note: A general session Info view over a host-authored sessionInfo Remote

Status: implemented

## Problem

The session conversation view could tell a user what a session cost, but not what the session *is*. The Session id, title, agent preset, durable model route, working directory, turn and step counts, the Workspace accounting it, whether commands run on the host or inside a container, and which sandbox and approval policy is in force were all owned by separate host services and none of them reached the Web client. A user had to reconstruct that picture from the transcript, the shell output, or the configuration files. The existing Spend tab was the only session-level projection, and its package name and copy framed the whole tab around one upstream vendor.

## Decision

The [session Info intent](../../../../.specs/ui/session-info-tab.spec.md), carried by the [accepted implementation task](../../../../.specs/tasks/session-info-tab.spec.md), ships through one new host package and one reshaped client package.

The host package `@deepseek-ai/dsh-session-info` at `packages/api/session-info` publishes one Typert Remote method, `sessionInfo.read({ sessionId })`. It injects only `sessions` and `sessionProjections`; the sandbox policy, approval service, and Workspace registry are optional peers read through `ctx.get()`, so a deployment can compose the capability without any one of them. It takes one synchronous projection cut over `title`, `agentPreset`, `modelSelection`, `sessionStats`, and `permissions`, so every projection-derived field reflects the same log position.

**Every fact comes from the service that owns it.** The Session header supplies identity and working directory; the projection units supply the title, preset, model route, and counts; `ctx.sandboxPolicy.resolve()` supplies the effective mode and `workspace-write` root; `ctx.approval.overrideOf()` plus its configured default supplies the effective approval policy; `ctx.workspaceRegistry.list()` supplies the Workspace accounting the session; and `node:os` plus `process` supply the host environment. The service never derives a policy value by re-reading the session log, and it never reads another package's projection *state*.

**Absence is explicit.** A fact whose owner is not composed is `null`, never a substituted default: no Workspace registration, sandbox policy, approval service, or permission projection each report their own absence, and the client renders that as locale-owned "Unavailable" copy rather than a plausible-looking value. A session absent from the live registry answers a stated `session-unavailable` failure rather than a persisted summary.

**The client tab is renamed and sectioned, not duplicated.** `@deepseek-ai/dsh-client-ui-session-info` at `packages/client/ui-session-info` replaces `@deepseek-ai/dsh-client-ui-openrouter-spend`. It keeps the one `conversation.view` contribution but registers id `info`, label "Info", and renders Session, Workspace, Environment, and Command-authorization blocks before the existing OpenRouter spend block. The spend reading is unchanged on the host side: it stays the separate `openrouterSpend` Remote, and the client store carries it as a nested reading that settles independently, so a spend failure degrades only the spend block while a session-info failure fails the view.

**Policy values are shown as their machine keys.** The file policy, approval policy, and permission preset render as `read-only` / `workspace-write` / `danger-full-access`, `ask` / `never`, and the preset key, because those are the product concepts the `/permission` command and the settings UI already name; the client does not re-derive their human wording from a second table.

## Alternatives considered

**A client-only view over existing projections.** Rejected because the most load-bearing facts are not exposed to the client: the host platform, OS release, Node version, and home directory have no Remote or session event, the deployment's default file and approval policies live on host services, and the Workspace registration is not readable from a session projection. A client-only view would have shown a narrower picture under a tab labelled as general information, and would have taught a maintainer that the projection keys *are* the full environment.

**Extending the existing `openrouterSpend` Remote with a second method.** Rejected because the package is named for one upstream vendor and owns one credential-scoped reading; a session environment read has neither that credential nor that vendor. Keeping them separate preserves one home per fact and lets either capability be composed without the other, which is why the web bundle mounts two rows and the client reads two namespaces.

**A dedicated `sessionInfo` session projection.** Rejected because a projection is a replayable fold over the session log, and most of this snapshot is not session-log state at all: the host platform, the Node version, the composed default policies, and the Workspace registration are process and composition facts. A projection would either persist values that do not belong to the log or re-materialize them per read, and its wire schema would force a `stateVersion` bump for every added host fact. A direct Remote read states exactly what it is: a point-in-time reading from live services.

**Adding a `./client` face to the new host package instead of a browser package.** Rejected because the browser contribution must bundle React and register a slot effect, which is the client-plugin manifest's job; the host package stays a single host compiler face with a generated `/remote` artifact.

## Consequences

A user opening a session sees what the session is, where it runs, and what it may do, in the same tab strip as Chat and Trajectory, with the OpenRouter spend rows preserved below. A deployment that composes no sandbox policy, approval service, or Workspace registry still gets a useful view whose unsupported fields read as unavailable rather than wrong, and the capability itself loads with only the session registry and the projection registry present. Renaming the client package is a breaking change to the public `@deepseek-ai/dsh-client-ui-openrouter-spend` specifier under the repository's pre-stable API policy; the host `@deepseek-ai/dsh-openrouter-spend` package is unchanged, so deployments that only compose the host side are unaffected. The snapshot reports repository state — branch, commit, dirty files — nowhere; adding it later requires a new owner with a real source rather than a client-side guess.
