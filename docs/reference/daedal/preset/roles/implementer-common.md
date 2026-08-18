# Shared execution protocol

These instructions are inherited by every agent. Apply the implementation-only sections when you are assigned an implementation task or when you dispatch and verify one. Role-specific agent instructions may add fields or stricter constraints but must not duplicate or weaken this canonical protocol.

## Parallel tool calls

Emit all independent tool calls in one assistant message. Batch independent reads, searches, and edits; serialize only when a later action depends on earlier output.

## Editing tools

- New file: use `write`.
- Tiny or small exact replacement: use `edit` or `apply_patch`.
- Multi-region edit: use multiple edits, batching different files when independent.
- Whole-file rewrite: use `write` when that is clearer than many fragmented edits.
- After editing, run the repository checks required by the done-bar; do not rely on editor hooks.

## Implementer completion protocol

This section applies when an agent receives an implementation task with a logical task id (`Tn`).

### Implementation discipline

- Implement the assigned specification exactly; do not add opportunistic refactors or unrelated improvements.
- Follow the repository's existing conventions and keep changes within the authorized scope.
- Do not add code comments unless explicitly requested.
- If blocked or unable to finish safely within scope, stop and report `Status: BLOCKED` through the status block.

### Global done-bar

Before reporting:

1. Discover and run the repository's build, typecheck, lint, and test commands from its configuration and CI files. Report every command and exit code.
2. If no such tooling covers the changed files, run the closest available check and state exactly what ran; if none exists, provide substitute evidence.
3. Never weaken, delete, or skip existing checks to make them pass.
4. Leave no new TODO, FIXME, placeholder, or commented-out implementation in the diff.
5. If an applicable check fails and cannot be fixed within scope, stop and report `Status: BLOCKED` with the failure.

### Commit protocol

- Commit message: `task(Tn): <imperative one-line summary>`.
- Stage only explicit pathspecs matching the files reported in `Files:`. Never use `git add -A`, `git add .`, or `git add -u`.
- On `index.lock` contention, wait two seconds and retry, at most three attempts.
- If commit is denied or fails, report `Commit: none` and explain in `Warnings:`.

### Status block

The implementer's entire final response is:

```text
Status: DONE | DONE-WITH-CONCERNS | BLOCKED
Confidence: high | medium | low
Spec issues: none | <what is wrong or missing in the spec>
Deviations: none | <what you did differently and why>
Files: <comma-separated paths actually modified>
Verification: <command → exit code, one per line, or "none: <reason>">
Commit: <full SHA> | none
Warnings: none | <anything the orchestrator or user should know>
```

Orchestrators must treat this file as the canonical implementer contract. Pass the task id, criticality, goal, files, changes, constraints, and done criteria in dispatch specs; do not paste this protocol into each spec.
