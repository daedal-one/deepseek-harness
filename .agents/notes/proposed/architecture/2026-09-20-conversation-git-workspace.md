# Agent Note: Conversation-owned Git workspaces

Status: proposed

## Problem

The [local container runtime](../../../../packages/sandbox/local-container-runtime/README.md) owns one process-wide workspace that starts empty and disappears at teardown. A Session can name a host repository while its file and process tools see an empty `/workspace`. Copying the repository into that shared directory would mix independent conversations and still lose their work on restart.

The coding agent needs ordinary repository contents, coherent working paths, and normal Git behavior. Import, return, checkpointing, and container recovery are Harness responsibilities. Making the agent orchestrate those operations consumes context and makes data preservation depend on model behavior.

## Proposal

Implement [conversation Git workspace intent](../../../../.specs/sandbox/conversation-git-workspace.spec.md) through the [accepted implementation task](../../../../.specs/tasks/conversation-git-workspace.spec.md). Each top-level conversation owns an independent repository on bounded memory-backed storage. DSH imports the current workspace automatically, checkpoints privately, and returns committed branches to the host after every successful turn. Remote push and integration into the user's checkout retain their separate authorization.

This proposal extends the [local container execution-world proposal](2026-09-18-local-container-execution-world.md). Its container isolation, replacement environment, process-range ownership, and external-effect authorization remain applicable. Conversation routing and recoverable storage replace its initial single-world, empty-volume lifecycle only when this new composition is selected. The older proposal remains active because those isolation decisions are not superseded.

## Coding-agent experience

The agent starts in `/workspace` with repository contents, usable Git history, a normal task branch, and an explicitly configured non-secret commit identity. All reported working directories, tool paths, project instruction discovery, and repository inspection refer to that execution namespace. The host retains the source repository identity separately. Global instruction content may be imported as a bounded immutable input; the host home is never mounted. Project instructions are read from the imported workspace so edits and nested discovery stay coherent.

The only additional coding guidance is: "Make granular commits as coherent changes are completed. Commit only changes within the requested task scope. Leave the working tree in the best recoverable state when stopping." This is proposed model-visible text: implementation must log it and update the owning recorded-session snapshot. The prompt contains no import/export procedure, container identifiers, recovery commands, or host Git credentials. The finalizer treats agent-written summaries as prose, never as authority for completion or publication.

DSH exposes lifecycle state to the user independently of the agent's answer: preparing workspace, working, saving changes, returning branch, synchronized, or retained with an error. The user's current host branch and files remain stable while returned branches become available for review. The agent need not mention these transitions in its response.

## Ownership and preparation

The durable owner is a top-level conversation, not a profile, standing preset mount, container process, or incidental current directory. A workspace record pins a branded workspace identity, source repository identity, source base OID, input-baseline OID, working branch, import manifest, storage generation, and last acknowledged checkpoint and return. Child agents inherit that workspace; an independent conversation or explicitly isolated child receives a separate owner. Forking a conversation snapshots a defined generation into a new owner rather than aliasing mutable storage.

Filesystem, subprocess, shell, search, terminal, job, LSP, instruction, and Client file-view consumers resolve an owner-bound handle. A handle binds both providers to one opaque execution-world identity; an unresolved initiator is an error. The process-global provider swap and standing preset scope cannot supply this identity. The policy bypass must verify the resolved handle for each operation, including resumed jobs, instead of accepting one process-global marker.

Before model admission, the importer resolves the repository root and selected HEAD, handles a workspace rooted below that repository as an execution-relative cwd, and captures source index state, tracked file changes including deletions, and non-ignored untracked files. A bounded manifest records identities, modes, content hashes, and exclusions. Capture revalidates HEAD, index, and selected files; observed concurrent changes cause bounded retry, then a preparation error. A directory with an unmerged index, unsupported repository layout, or no Git repository cannot silently become an empty sandbox or an invented project.

Git objects and selected refs enter an independent repository through a bounded bundle. Files enter through a validated manifest. Host `.git/config`, hooks, reflogs, credential helpers, linked-worktree pointers, and object alternates are not copied. Repository-controlled filters or hooks cannot run on the host transfer path. Submodules and LFS require declared support that includes their object/content payloads; a pointer alone does not constitute successful import. Import preserves supported confined relative symlinks as links, never follows them, and validates the resulting tree for escapes and cycles. Special files and links outside the imported tree reject preparation. This supported-link policy requires the scoped extension of the initial import/export requirement, which rejects all symlinks.

When the source is dirty, DSH records a fixed-message input-baseline commit in the private repository before exposing the task branch. The source checkout and index remain untouched, and the original staged/unstaged distinction remains in the private import manifest. The agent therefore begins from a clean checkout that already includes the user's local work. Returned history includes that labelled baseline; the user-facing change comparison is input baseline to result, while original HEAD to result shows the complete branch. The baseline has a Harness identity and is never attributed to the coding agent. A clean import reuses its source base without an empty baseline commit.

## Successful-turn finalization

The trigger is a durable successful `turn/end`, not assistant text, socket closure, or a transient idle event. Error, cancellation, and interruption follow recovery preservation without successful-turn publication. One transaction identity combines workspace identity and durable turn identity; a recorded successful turn with no receipt is recoverable pending work.

| Phase | Harness action | Durable fact before advancing |
|---|---|---|
| Acquire | Close admission of new workspace mutations and wait for existing writers | Finalization identity and owner lease |
| Capture | Freeze repository refs, index, and eligible working files | Candidate generation and content digest |
| Commit | Retain agent commits and settle residual files if needed | Exact commit inputs and resulting OID |
| Checkpoint | Publish a complete private recovery generation | Verified checkpoint receipt |
| Return | Validate and import pinned result refs on the host | Destination OIDs and return receipt |
| Release | Reopen mutation admission and report outcomes | Locally settled generation and return status |

The barrier covers child agents, terminal processes, background jobs, LSP writers, and filesystem calls. A process remains a possible writer even when no tool call is active; Git's index lock alone is insufficient. The first implementation may require relevant processes to exit before capture. A writer deadline preserves the workspace and reports pending finalization; it neither kills work silently nor snapshots a changing directory and labels it consistent. Recovery of long-lived services requires a separately proven freeze/snapshot mechanism if waiting for their exit is unacceptable.

Queued turns wait for local capture, commit, and checkpoint. After that immutable generation exists, host return may retry asynchronously while later turns proceed. Returns are serialized by generation so an older retry cannot move the visible result behind a newer receipt. A configured pending-byte or generation bound stops further admission before retained export data exhausts storage. A completed model turn remains completed if saving or return fails; the independent lifecycle status records the failure.

The residual commit includes all changed tracked files and all eligible non-ignored untracked regular files or supported links in the workspace, including deletions. It operates on the frozen complete tree rather than trusting a partially staged index. Harness metadata and declared dependency/build caches live outside the task repository or in host-owned exclusions. Project ignore rules remain effective. Eligibility is deterministic; oversized or disallowed content blocks settlement with a retained checkpoint rather than being silently dropped. A residual commit is labelled recovery work and does not imply that tests passed or that a partially finished task is complete.

Existing commits are never squashed or rewritten by finalization. If HEAD is detached or the agent deletes the task branch, DSH pins the actual HEAD under a deterministic recovery ref before adding a residual commit. Unmerged index entries or an in-progress merge/rebase block residual commit creation; DSH checkpoints the state and reports the condition without deciding how to resolve it. A clean tree creates no extra commit. Newly created local branches are pinned and returned under conversation-owned names; deletion inside the sandbox never deletes a host branch or ref.

## Commit-message model

Only residual commit-message wording uses an auxiliary LLM. A configured low-cost route receives a bounded diff summary and bounded text hunks from the already frozen tree. Binary content is represented by path and size metadata. Its input is untrusted repository data; the service exposes no tools, network actions, credentials, or writable workspace. The model returns one plain-text commit subject. It cannot choose paths, stage files, run Git, select parents, resolve conflicts, choose a remote, or decide whether work is successful.

Code validates the subject, rejects control characters and extra fields, and applies configured input/output, timeout, and cost limits. Unavailable routing, timeout, invalid output, or an input that cannot be represented within policy uses the fixed subject `chore: save remaining changes for turn <n>`. There is no retry conversation or second classification model. No residual diff means no auxiliary call. Commit policy and permitted validation hooks come from trusted deployment configuration; an automatic host commit path never executes project-supplied hooks or filters. Required project checks run inside the sandbox and retain their own reported results.

The model's wording is not intrinsically deterministic. DSH makes transaction replay deterministic by persisting the selected message, tree, ordered parents, bot identity, and timestamp before publishing the commit/ref. The timestamp derives from the recorded finalization input, not the retry clock. Once recorded, retries reuse those inputs and OID. A crash before any response is recorded chooses the fixed fallback when recovering rather than asking the model again. Each automatic commit carries machine provenance for the workspace, turn, and input snapshot; model-written prose cannot forge those fields.

## Private recovery and storage

Use an explicitly provisioned tmpfs pool with a separately bounded byte/inode allocation for each workspace and an aggregate admission budget; ordinary subdirectories of one tmpfs do not supply per-workspace quotas. Merely placing a directory below `/tmp` does not establish memory-backed storage. Allow execution of built artifacts on the private workspace while retaining namespace, user, capability, privilege, device, and network controls. Runtime images and declared dependency provisioning must supply the tools and caches needed for offline builds. Dependency fetching is a separately bounded host capability, not ambient credentials or unrestricted sandbox egress.

Workspace storage outlives container instances. Controller failure, service restart, process cancellation, or world recreation releases process resources without deleting the workspace record or its last recoverable data. A supervisor owns leases and retention. On resume, DSH restores the latest acknowledged generation before permitting any model/tool access. It never silently imports newer source files into an existing conversation. Host changes after initial import remain separate until an explicit rebase/import operation is requested.

Private checkpoints preserve reachable and recovery-pinned Git objects, refs, index state, tracked and untracked workspace content, and the import/finalization manifest. Recomputable caches are excluded only through declared policy. Ignored files that are not declared disposable still need recovery if created during execution. Atomic publication writes and verifies a new generation before replacing its pointer; the previous valid generation stays available until the replacement is acknowledged. Checkpoints at quiescent execution boundaries and controlled shutdown reduce loss; a host crash can still lose writes after the last acknowledged checkpoint. The product must report that recovery cut honestly.

Cancellation first revokes mutation admission and reaches process quiescence, then checkpoints dirty state. A timeout that destroys a controller must retain storage for this recovery path. A full disk, quota failure, corrupt checkpoint, or failed cleanup never becomes permission to erase unsaved work. Expiry may suspend execution; destructive retention of unexported work requires a separately declared user policy. Automatic Git return does not make uncommitted or ignored files disposable.

## Host branch return

The host broker transfers only immutable pinned Git objects and refs. It validates the bundle in a private staging repository with sanitized Git configuration, hooks disabled, resource limits, object integrity checks, expected prerequisites, and an exact source/target manifest. Bundle validity does not prove safe content or successful tests. No sandbox path, remote URL, refspec, hook, or command becomes executable host authority.

After validation, the broker imports committed results into `refs/heads/dsh/<workspace-id>/<branch-key>` in the source repository. The host assigns and validates branch keys; raw sandbox branch names cannot become refspecs. Initial return creates new refs; subsequent updates compare the destination's observed OID to the last acknowledged OID. An unchanged destination may advance to the pinned result. Rewritten history, a destination checked out in any worktree, or an external ref edit causes a new deterministic generation branch rather than overwriting the existing destination. The broker publishes all refs for one repository generation atomically and never deletes unrelated refs. Returning a submodule set requires child-repository receipts before the superproject pointer can be marked available.

The receipt records generation, source input baseline, exported ref/OID pairs, destination ref/OID pairs, bundle identity, and validation outcome. An identical replay acknowledges the same receipt without another commit or model request. An uncertain crash after ref publication reconciles actual refs against the journal before retrying. The broker never edits host working files or index, moves an existing user branch, or pushes to a remote. A host-side push may later publish selected returned refs under its own authorization and credentials.

## Implementation ownership

Use a complete workspace capability with an explicit service definition, local-container provider, and lifecycle/return consumers. Separate Git transfer and message generation from container process ownership because they have different authorization and failure lifetimes. The accepted task fixes behavior; exact package names remain an implementation choice.

The workspace owner supplies branded handles and mutation leases to the filesystem/subprocess providers. The Session integration records preparation, baseline, checkpoint, commit, and return facts and admits turns only when their execution generation is ready. The finalizer attaches to durable turn settlement and owns retry scheduling; it does not insert an invisible coding-agent follow-up. The host Git broker alone may mutate reserved result refs. Client projections and both SDKs expose execution and synchronization outcomes separately. If existing extension points cannot hold admission through local settlement, add a documented lifecycle extension with both SDK and snapshot coverage rather than polling `idle`.

## Alternatives considered

**Ask the coding agent to import, checkpoint, or export.** Rejected because preservation would depend on model compliance, consume task context, and require the agent to reason about host capabilities it does not need.

**Require a user export action after each turn.** Rejected for this workflow because automatic return to reserved branches provides deterministic availability without modifying the user's checkout. Remote push remains separate.

**Synchronize changed files into the source checkout.** Rejected because it can overwrite concurrent user edits and exposes partial state. Branch return preserves a reviewable commit graph and the host working tree.

**Let the cheap model choose changes or run Git.** Rejected because it turns a bounded text task into another agent with mutation authority. Candidate trees and commit publication belong to deterministic code.

**Expose imported dirty files as unexplained agent changes.** Rejected because a later fallback commit would blur user input and generated work. A labelled input baseline and preserved source-status manifest make both comparisons available.

**Use RAM storage without private recovery.** Rejected because process cleanup, reboot, and memory pressure must not silently destroy acknowledged work. Checkpoint durability remains distinct from automatic source-branch return.

## Acceptance criteria

- Two simultaneous conversations from one dirty repository get independent volumes, input baselines, task branches, and return refs; neither can observe or mutate the other's files through any supported consumer.
- Source HEAD, index, worktree, untracked files, and existing branches remain unchanged during import and return, including concurrent host edits and linked-worktree use.
- Ordinary coding tools complete a real import/edit/build/test/commit turn inside rootless Podman. Project instructions and all displayed execution paths refer to imported content; no extra lifecycle tools or agent round trips are required.
- Agent granular commits survive unchanged. A residual diff gets one provenance-labelled commit; clean turns get no commit and no auxiliary model call. Seeded dirty input is distinguishable from the agent's changes.
- Crash injection before and after capture, model-message recording, commit creation, checkpoint-pointer publication, ref transaction, and return acknowledgement recovers without duplicate commits, repeated recorded message calls, stale ref rollback, or lost acknowledged work.
- Background processes, active subagents, long-lived terminals, and queued turns cannot race a declared consistent capture. Timeout and resource exhaustion retain work and expose exact pending outcomes.
- Cancelled/failed turns preserve dirty recovery state without successful publication. Missing/corrupt recovery never resumes into an empty or newly reimported repository.
- Escaping symlinks, special files, corrupt objects, hostile configuration/hooks/filters, unexpected bundle refs, unsupported repository layouts, and oversized inputs reject before host effects.
- Recorded Session replay and TypeScript/Python SDK expectations distinguish turn, local-save, checkpoint, and host-return outcomes. Real GUI verification shows those states and a returned branch without an agent instruction to perform transport.

## Risks

Snapshot consistency across arbitrary long-lived writers is the largest lifecycle risk; waiting for process exit is safe but can delay automatic return. Input baselines add a machine-authored commit when the user's source is dirty, so review must offer both input-relative and source-HEAD-relative comparisons. Automatic residual commits preserve bytes, not semantic completeness or passing tests. Tmpfs and recovery storage need independent quotas because a successful memory snapshot can still fail durable publication. Multiple repositories, LFS payloads, and rewritten branches require more than a single happy-path Git bundle fixture. Auxiliary wording varies on first execution; only recorded transaction replay is deterministic.
