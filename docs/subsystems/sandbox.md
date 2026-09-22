# Process Sandbox

The process-sandbox seam of [dsh-sandbox](../../packages/sandbox/sandbox) wraps a same-world subprocess argv in a file-effect policy without coupling consumers to a platform runner. [dsh-sandbox-local](../../packages/sandbox/sandbox-local) supplies Linux bwrap/Landlock, macOS Seatbelt, and the Windows ACL restricted-token backend; [dsh-bash-sandbox](../../packages/shell/bash-sandbox) and [dsh-pwsh-sandbox](../../packages/shell/pwsh-sandbox) consume it. Containers, microVMs, and remote execution are sibling implementations of whole capability seams, not providers of `ctx.sandbox`.

Source: [`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

## Modes and enforcement

`SandboxMode` governs filesystem effects only. `read-only` asks the backend to deny writes — the POSIX runners additionally grant the `/dev/null` sink their shells require, while the Windows ACL runner grants no explicit writable root and reports partial enforcement for its ambient ACL gaps; `workspace-write` permits writes under the workspace root and the backend's promised temp area; `danger-full-access` bypasses confinement. Network and process visibility are outside this vocabulary.

```ts type-equiv
/**
 * File-effect policy for confined processes. `read-only` permits only required
 * sinks such as `/dev/null`; `workspace-write` also permits the workspace and a
 * backend-defined temp area; `danger-full-access` bypasses confinement. Network
 * and process visibility are outside this vocabulary.
 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

Only the first two modes can be sent to a provider. A `danger-full-access` consumer spawns its original argv and does not call `ctx.sandbox`.

```ts type-equiv
/** A confining (non-`danger-full-access`) mode — the modes a {@link SandboxPolicy} can carry. */
type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>
```

Enforcement is a reported fact. `full` means the backend governs every file effect promised by the mode; `partial` means an active backend or older kernel ABI governs only a subset, so consumers that require the absolute promise must reject or surface that distinction. Older Landlock ABIs and the Windows ACL runner's Everyone/hard-link boundaries are current partial cases.

```ts type-equiv
/**
 * Enforcement completeness for this host. `partial` means an active backend or
 * older kernel ABI cannot govern every promised file effect; callers requiring
 * an absolute boundary must not treat it as `full`.
 */
type SandboxEnforcement = 'full' | 'partial'
```

## Per-call policy

The complete execution policy is resolved and carried per capability call. It includes `danger-full-access` so a consumer can resolve policy once before deciding whether to bypass confinement. Normal tool calls derive `workspaceRoot` from the calling session's immutable cwd; deployment configuration is the agentless fallback. The root is canonicalized with filesystem semantics before lexical normalization, so a cwd containing `symlink/..` identifies the directory where a spawned process actually runs.

```ts type-equiv
/**
 * The complete file-effect policy resolved for one capability call. The root
 * is carried even under modes that do not consume it so callers can resolve
 * policy once before choosing the enforcement path.
 */
interface SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: SandboxMode
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string
  /**
   * Opaque identity of the calling session (the branded `dsh-session`
   * SessionId). Backends key per-session state off it (e.g. windows-acl gives
   * each live session/workspace pair a random private temp directory and SID,
   * while the workspace SID and standing grant remain per-workspace); absent
   * for agentless calls, which fall back to per-call backend state.
   */
  sessionId?: SessionId
}
```

`ctx.sandboxPolicy.resolve()` accepts the active session and, for an approved retry, an explicit mode. The service owns precedence and root fallback so bash and fs do not repeat it.

```ts type-equiv
/** Inputs that select the sandbox policy for one capability call. */
interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}
```

Only a confined execution reaches `ctx.sandbox`; its provider policy narrows the mode while retaining the same root. This permits concurrent sessions, consumers, and one-shot escalated retries to ask the same provider for different boundaries without mutating provider state.

```ts type-equiv
/**
 * What one confined execution is allowed to touch — carried PER CALL, not
 * fixed on the provider: two consumers may confine under different policies
 * at the same instant (bash under `read-only` while a confined child agent
 * needs its state directory writable), and an approved escalated retry is a
 * new call with a wider policy. Defaulting/resolution is an explicit step at
 * the consumer boundary; the provider treats the policy as fully specified.
 */
interface SandboxPolicy extends SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: ConfinedSandboxMode
}
```

<a id="wrapped-argv-and-classification-dialects"></a>

## Wrapped argv and classification dialects

`RunnerFailureRule` combines evidence that a runner failed before executing the command. A consumer requires a nonzero exit, the optional allowed-exit-code gate, and a case-insensitive fatal signature within one remaining stderr line. Case-insensitive exact full-line informational exclusions are removed first, so a benign runner notice cannot prove failure by itself. The matched line remains available as error detail; classification does not rewrite stderr.

```ts type-equiv
/**
 * Evidence that identifies a sandbox runner failing before it executes the
 * wrapped command. A consumer first applies {@link allowedExitCodes} when
 * present, removes {@link informationalLines} by case-insensitive exact line
 * equality, then matches {@link fatalSignatures} case-insensitively within
 * each remaining stderr line. Exit status alone never proves runner failure.
 */
interface RunnerFailureRule {
  /** Nonzero process exit codes on which this rule may match; omitted permits any nonzero exit. */
  allowedExitCodes?: readonly number[]
  /** Non-empty substrings identifying a fatal runner diagnostic on one stderr line. */
  fatalSignatures: readonly string[]
  /** Benign stderr lines excluded by exact full-line equality before fatal matching. */
  informationalLines?: readonly string[]
}
```

`ConfinedArgv` is what the consumer spawns. Besides the replacement argv, it carries the backend's enforcement fact and two orthogonal stderr classifiers. `denialSignatures` identify the confined command being blocked while the sandbox works correctly. `runnerFailureRules` identify the sandbox runner refusing or failing before it executes the command; consumers check these first and surface a sandbox infrastructure failure, never an ordinary task failure.

```ts type-equiv
/**
 * A {@link SandboxProvider.confine} result: the argv to spawn in place of
 * the caller's own, plus the enforcement completeness the selected backend
 * achieves for it.
 */
interface ConfinedArgv {
  /** The wrapped argv (runner, profile, separator, then the caller's argv). */
  argv: string[]
  /** How completely the selected backend enforces the policy's file effects. */
  enforcement: SandboxEnforcement
  /**
   * The selected backend's denial DIALECT: the case-insensitive stderr
   * substrings a file effect denied by THIS backend produces (EROFS text
   * under bwrap's read-only binds, EACCES under Landlock, EPERM under
   * Seatbelt). A consumer that infers denials from a failed run's stderr
   * matches against exactly these rather than a cross-backend union — the
   * union claims denials a given backend never produces.
   */
  denialSignatures: readonly string[]
  /**
   * Structured runner-failure evidence rules. Consumers require a matching
   * fatal stderr line (after informational exclusions) and any rule-specific
   * exit-code gate before checking denial signatures: runner failure means the
   * command never ran, while denial means confinement worked and blocked it.
   */
  runnerFailureRules: readonly RunnerFailureRule[]
}
```

The [local provider](../../packages/sandbox/sandbox-local/README.md) owns operator configuration and maps its runner dialect into these rules. The [sandboxed bash consumer](../../packages/shell/bash-sandbox/README.md) owns spawn and result attribution.

## Provider and fail-closed errors

`ctx.sandbox.confine(argv, policy)` returns a `ConfinedArgv` or throws `SandboxUnavailableError` with code `SANDBOX_UNAVAILABLE` when no usable backend exists. Consumers may also classify a failure while spawning or observing the returned argv; that attribution belongs to the consumer contract. Silent unconfined passthrough is never legal for a confined policy.

Provider selection, probing, caching, and backend-specific enforcement reports belong to the [local provider](../../packages/sandbox/sandbox-local/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxconversationworkspaces--conversationworkspaces"></a>

### `ctx.conversationWorkspaces` — `ConversationWorkspaces`

Owns private workspace storage, live agent bindings, and automatic branch return.

```ts cordis-catalog
/** Run a user-facing workspace operation with the selected live conversation.
 * @param sessionId - selected conversation identity from the host request.
 * @param operation - operation whose filesystem and process calls share that owner.
 * @returns the operation result; cold conversations must be opened first.
 */
runForSession<T>(sessionId: SessionId, operation: () => T): T

/** Capture the exact initiating conversation's world for one operation.
 * @returns an operation-local runtime; missing ownership rejects rather than using another workspace.
 */
capture(): LocalContainerRuntime

/** Resolve the executable lookup world before launching a process.
 * @returns the conversation world when attributed, otherwise the verified boot toolchain.
 */
resolveToolchain(): LocalContainerRuntime

/** Resolve source path aliases only for the initiating conversation.
 * @param path - source or execution path.
 * @returns the corresponding execution path, or the unchanged non-source path.
 */
executionPath(path: string): string

/** Request repository authority through the human question provider, then attach an isolated checkout.
 * @param agent - initiating top-level session; determines the environment and workspace.
 * @param repository - canonical HTTPS repository URL allowed by environment configuration.
 * @param access - fetch authority or explicitly approved push authority.
 * @param reason - task-related reason shown with the complete approval scope.
 * @param signal - cancellation of the pending question and attachment request.
 * @returns approval and readiness separately; paths appear only for attached repositories.
 */
async requestRepository( agent: Agent, repository: string, access: RepositoryAccess, reason: string, signal: AbortSignal, ): Promise<RepositoryRequestResult>
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/sandbox/local-container-runtime/src/workspaces.ts`](../../packages/sandbox/local-container-runtime/src/workspaces.ts)

<a id="ctxlocalcontainerruntime--localcontainerruntime"></a>

### `ctx.localContainerRuntime` — `LocalContainerRuntime`

Owns one disposable rootless Podman container. Provider adapters await getContainer; it resolves only after engine, image, created-container, and started-container inspection prove the configured controls.

```ts cordis-catalog
/**
 * Return the verified running container identity for provider adapters.
 * @returns the owner-retained Engine id and fixed workspace path.
 * @throws when engine verification, setup, or teardown prevents readiness.
 */
async getContainer(): Promise<LocalContainerHandle>

/**
 * Execute one owner-controlled provider controller in the verified container.
 * Caller cancellation or deadline expiry tears down the whole execution world,
 * because the Podman exec API cannot prove that it stopped one exec process.
 * @param request - bounded command, input, deadline, output limit, and cancellation signal.
 * @returns settled bounded standard streams and exit code.
 */
async executeController(request: PodmanControllerExecRequest & { readonly deadlineMs: number }): Promise<PodmanControllerExecResult>

/**
 * Create one independently removable process container in this execution world.
 * @param request - exact process, environment, terminal, and allocation cancellation facts.
 * @returns an attached started handle whose removal proves descendant quiescence.
 */
async createProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle>

/** Keep the engine available until a workspace supervisor finishes its child worlds.
 * @param shutdown - coalesced checkpoint and child-container disposal operation.
 * @returns unregister function, called only after that supervisor has finished shutdown.
 */
registerWorkspaceOwner(shutdown: () => Promise<void>): () => void

/**
 * Bind a separately owned workspace to a new isolated world on the same engine.
 * @param directory - trusted supervisor-owned private backing directory.
 * @param authorize - environment-owned credential issuance checked for each process admission.
 * @returns the verified world and its quiescent container disposer; storage is retained.
 */
async createWorkspace( directory: string, authorize?: () => Promise<string[]>, ): Promise<{ runtime: LocalContainerRuntime; dispose(): Promise<void> }>

/**
 * Revoke new writes and wait for all existing processes and controllers before capture.
 * @param timeoutMs - bounded wait for existing writers; expiry leaves them running.
 * @param operation - trusted capture operation with exclusive controller access.
 * @param quiesce - release managed idle processes before waiting for all writers.
 * @returns the capture result, with admission restored only after successful settlement.
 */
async settle<T>( timeoutMs: number, operation: (control: ( request: PodmanControllerExecRequest & { readonly deadlineMs: number }, ) => Promise<PodmanControllerExecResult>) => Promise<T>, quiesce?: () => Promise<void>, ): Promise<T>

/** Stop every owned subprocess before cancellation or shutdown recovery capture. */
async cancelProcesses(): Promise<void>

/** Stop stale process owners before restoring a supervisor-owned directory.
 * @param directory - exact private bind source whose storage must be quiescent.
 */
async recoverWorkspace(directory: string): Promise<void>
```

Source: [`packages/sandbox/local-container-runtime/src/index.ts`](../../packages/sandbox/local-container-runtime/src/index.ts)

<a id="ctxsandbox--sandboxprovider-abstract-seam"></a>

### `ctx.sandbox` — `SandboxProvider` (abstract seam)

Abstract process-sandbox service. confine must return enforcing argv or fail closed at wrap or runner-execution time; silent unconfined passthrough is forbidden. Functional probes arbitrate multi-runner chains and may be skipped for a sole candidate, whose own refusal remains the fail-closed end.

```ts cordis-catalog
/**
 * Wrap `argv` so it executes confined under `policy` on this host; the
 * caller spawns the returned argv in place of its own.
 * @param argv - the exact argv the caller is about to spawn (program plus
 *   arguments), NOT a shell string — a shell-shaped consumer passes
 *   `['bash', '-c', command]`.
 * @param policy - the file-effect policy this execution runs under,
 *   carried per call (see {@link SandboxPolicy}).
 * @returns the argv to spawn instead, plus the enforcement completeness
 *   the selected backend achieves for it.
 */
abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
```

Source: [`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

<a id="ctxsandboxpolicy--sandboxpolicyservice"></a>

### `ctx.sandboxPolicy` — `SandboxPolicyService`

The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment default mode, fallback workspace root, and current request-time policy section. Tool layers call resolve for each execution so a session's mode log and immutable cwd travel together to every enforcing capability.

```ts cordis-catalog
/**
 * Resolve the complete policy for one capability call. An approved explicit
 * mode outranks the session's last `sandbox/mode` event, which outranks the
 * deployment default. A session cwd is its workspace-write boundary; the
 * configured root is the fallback for agentless calls and sessions without a
 * cwd.
 * @param request - optional session and approved mode override.
 * @returns the fully resolved per-call mode and absolute workspace root.
 */
resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy

/**
 * Read the session override without applying the deployment default.
 * @param session - session whose log supplies the override.
 * @returns the last logged mode, or `undefined` without one.
 */
overrideOf(session: Session): SandboxMode | undefined
```

Types: [Session](session.md)

Source: [`packages/sandbox/sandbox-policy/src/index.ts`](../../packages/sandbox/sandbox-policy/src/index.ts)

<a id="workspace-events"></a>

### `workspace/*` events

<a id="workspacequiesce--serial"></a>

#### `workspace/quiesce` — serial

Release idle managed processes before capturing a workspace with mutation admission closed.

```ts cordis-catalog
/** Release idle managed processes before capturing a workspace with mutation admission closed.
 * @param payload.executionWorld - exact world whose process owners must drain.
 * @mode serial
 */
'workspace/quiesce'(payload: { executionWorld: object }): Promise<void> | void
```

Source: [`packages/sandbox/local-container-runtime/src/index.ts`](../../packages/sandbox/local-container-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Local container execution world

The optional [runtime owner](../../packages/sandbox/local-container-runtime/README.md) supplies a verified process-owned workspace to matching filesystem and subprocess providers. `LocalContainerHandle` identifies the owner and canonical workspace; `PodmanControllerExecRequest` and `PodmanControllerExecResult` define bounded controller input, output, cancellation, and deadlines. `LocalContainerProcessRequest` supplies an explicit process, environment, cwd, and terminal dimensions, while `LocalContainerProcessHandle` owns its streams, exit observation, signalling, and removal. The [type declarations](../../packages/sandbox/local-container-runtime/src/types.ts) define these provider-facing values.

The optional conversation-workspace service owns import, recovery, residual commits, and branch return. `ConversationWorkspaceId` identifies one private repository; `WorkspaceState` records its save phase, acknowledged checkpoint, baseline commit, and returned refs independently of `turn/end`. The [shared declarations](../../packages/sandbox/local-container-runtime/src/workspace-types.ts) define the durable receipt; the [configuration and lifecycle](../../packages/sandbox/local-container-runtime/README.md#conversation-repositories) define ownership and limits.

With environment configuration, independently stored session attachments select multi-repository workspace identities. `EnvironmentId` identifies the authority owner, `RepositoryGrant` records an approved repository capability and revision, and `RepositoryAccess` distinguishes fetch from push. `EnvironmentAccessConfig` supplies the operator's requestable catalog and initial grants. Their [declarations](../../packages/sandbox/local-container-runtime/src/environment-types.ts) and [repository access semantics](../../packages/sandbox/local-container-runtime/README.md#repository-remotes-and-outbound-access) define the approval, expiry, and credential limits. `WorkspaceState.repositories` reports independent repository return outcomes.
