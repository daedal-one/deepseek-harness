# Agent Note: Session Info environment identity

Status: implemented

## Problem

The Info tab reports a Session's execution **placement** (host, container, external, unknown), but placement only classifies a Session; it does not identify the environment instance it runs in. Two Sessions both placed `container` may run in the same or in different containers, and the reading carries no fact a user could compare to answer "are these the same environment?". The request was to show a unique per-environment id, with the container id as the motivating example.

The authority for "same environment" already exists in the runtime: `executionEnvironment` in `dsh-permission-presets` verifies placement by comparing the effective filesystem and subprocess providers' `executionWorld` values, and the resume guard in the same package rejects resuming a started Session in a different known environment. Any identity shown to the user should agree with that same verification rather than introduce a second notion of environment.

## Decision

`dsh-permission-presets` now exposes `executionEnvironmentObservation(ctx, agent)`, returning `{ environment, environmentId }` from one reading. `executionEnvironment` remains a thin wrapper over it, so placement and identity cannot disagree about which world was verified. Each distinct `executionWorld` value is assigned a process-local identity lazily: the host symbol receives one `host-xxxxxxxx` id per process, and every object world receives one `env-xxxxxxxx` id held in a module-level `WeakMap`. A world symbol the Host does not own, absent providers, or mixed providers yield `null`.

`dsh-session-info` adds `environmentId: string | null` to `SessionInfoEnvironmentFacts`. `SessionInfoService.read` resolves the Session's live Agent through `ctx.agents` and reads the identity with `executionEnvironmentObservation`; the recorded `permissions.context.environment` still supplies `placement`, because that projection is the durable authority for the resume guard. A missing Agent or a refused observation (preset admission can reject an observation mid-restore) degrades to `null`, matching the service's contract that every unowned fact is an explicit `null`.

The Info view renders the value as an **Environment id** row under **Execution placement**, through the shared `Unavailable` wording when it is `null`.

## Alternatives considered

**Report the container engine id.** The most literal reading of the request: read `LocalContainerDiagnostics.containerId` (or `containerName`) from the owning runtime and show that. It lost because the diagnostic lives on a specific runtime instance while the Session's effective providers are resolved per preset, so wiring it would add a new optional identity member to the filesystem and subprocess capability seams and to every provider. It would also be a second notion of environment beside the one the resume guard enforces. The chosen identity distinguishes container instances the way the engine id would, because each workspace runtime owns a distinct `executionWorld` object.

**Record the id durably in `permission/context`.** Placement already travels through that event, so the id could ride along and `SessionInfoService` would need no Agent lookup. It lost on two counts: `PermissionContext` is documented as recorded presentation context with provider identities explicitly process-local, and a process-local id in a durable event would be stale after every resume and would append a context event on each one.

**Show the connection Host id.** The Web client already knows the Host it is connected to. It lost because one Host answers for every Session it serves, including Sessions in different containers, so it cannot distinguish environments.

## Consequences

Equal `environmentId` values mean two Sessions resolved to the same `executionWorld` object on the Host serving the read. The id is deliberately process-local and not durable: a restarted Host or recreated container names a new world, so the id is a comparison key between concurrent Sessions, not a stable environment record, and the row's copy does not promise durability.

Placement and identity have different owners by design: `placement` stays the recorded projection value while the identity is read from live providers. A Session whose Agent is unavailable or whose observation is refused reports `null` rather than failing the read.

`dsh-session-info` gains a peer and dev dependency on `@deepseek-ai/dsh-agent` and a project reference to `packages/core/agent` for the `ctx.agents` declaration; it already depended on `dsh-permission-presets`, so the new value import adds no package edge.

Coverage: `packages/interaction/permission-presets/tests/environment.spec.ts` pins identity assignment, stability per world object, host sharing, and the null cases; `packages/api/session-info/tests/service.spec.ts` pins the observed id and the unobservable-world null; `packages/client/ui-session-info/tests/info-view.client.spec.tsx` pins the rendered row.
