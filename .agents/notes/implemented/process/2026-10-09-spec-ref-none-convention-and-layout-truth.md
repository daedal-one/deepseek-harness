# Agent Note: Repository layout truth and the Spec-Ref none convention

Status: implemented

## Problem

The repository layout block in the root `AGENTS.md` listed 35 package groups while `packages/` holds 53, and it named two directories that do not exist: `self-modification/` (the group is `extensions/`) and `support/` (the group is `test-support/`). The group table in `packages/README.md` omitted `integration/`, `mcp/`, and `memory/`. The `packages/runtime-diagnostics/invariants/README.md` summary claimed the standard agent composition mounts the registry with the four core companions, while a shipped `dsh-base` host never loads it. The specification workflow paragraph stated Specs Format v0.6 against the tree's `forge-spec-v0.7.0` baseline, and no rule made a behavior-changing commit without an applicable spec state that absence.

## Decision

The root `AGENTS.md` layout block names every group under `packages/` in the real tree, one line per group, alongside the group table in `packages/README.md`; both files stay inside their `verify-doc-budgets` ceilings, with the layout block carrying a short role per group and the table owning the longer role text. The `packages/runtime-diagnostics/invariants/README.md` summary states that development and test compositions and the `sdk-minimal` profile mount the invariant service with the four core stateful companions, and that shipped `dsh-base` hosts deliberately do not load it.

The specification workflow states Specs Format v0.7 with the `.specs/_config.toml` `forge-spec-v0.7.0` baseline, and it adds the none convention: a commit that changes behavior and has no applicable spec carries `Spec-Ref: none (<reason>)` with a non-empty reason. The lefthook `commit-msg` gate requires a `Spec-Ref:` trailer on `feat`, `fix`, and `perf` subjects and leaves merge commits and the remaining conventional prefixes (`docs`, `chore`, `test`, `refactor`, `ci`, `build`, `style`) exempt.

The gate lives in `../../../../scripts/verify-spec-ref-commit-msg.ts` and receives the commit message file path as its first argument. It reads the subject as the first non-blank, non-comment line; a real reference resolves against the `id:` frontmatter of every spec file under `.specs/`, with an optional `#fragment` stripped before the lookup. An unresolvable reference fails with the three declared ids nearest by edit distance, and the none form fails when its reason is empty. The task record is `../../../../.specs/tasks/spec-ref-none-convention.spec.md`.

## Alternatives considered

**Require a spec for every behavior change.** Every gated commit would name a TASK, and no reason text would be necessary. It loses because a behavior change can land with no applicable accepted spec, and inventing one to satisfy a gate puts intent in a home that does not own it.

**Leave behavior-changing commits without a spec unmarked.** The gate would accept any message and the convention would rest on review memory. It loses because a silent omission is indistinguishable from a forgotten trailer, while `Spec-Ref: none (<reason>)` is greppable evidence of a deliberate choice.

**Adopt a commitlint rule or a general trailer checker.** A maintained dependency would replace the hand-written parser. It loses because the repository already runs repo-owned TypeScript gates through lefthook and a second commit-message convention would govern the same line.

**Keep the layout block as a partial group list and link `packages/README.md` for the rest.** The block would stay short and the table would remain the single inventory. It loses because a list that stops at 35 of 53 groups reads as complete and sends readers to the wrong directory names.

**Raise the `AGENTS.md` ceiling instead of condensing.** The missing groups would fit without touching existing prose. It loses because the required content fits after condensing duplicate commentary and command comments, and a raised ceiling spends the budget permanently.

## Consequences

Every gated commit pays one short-lived `tsx` process, and a missing or wrong trailer costs a rewritten message through `git commit --amend` or `--edit`. Merge commits created by `git merge` bypass the check, so a merge message that summarizes gated work stays unchecked.

A new package group changes two files, because the root layout block and the `packages/README.md` table both enumerate groups; the block keeps one short line per group while the table keeps the authoritative role text. The layout block loses the per-group detail it once duplicated from the group READMEs.

The gate checks the commit message alone. It cannot establish that a named spec governs the change, that a `none` reason is true, or that an exempt prefix describes a change with no behavior impact; review owns those judgments.

## Verification

`pnpm exec vitest run scripts/verify-spec-ref-commit-msg.spec.ts` covers a declared reference, a fragment reference, the none form with and without a reason, a missing trailer on `feat`, `fix`, and `perf`, an unresolvable reference with its closest ids, the three-id suggestion cap, merge-commit skipping, the exempt prefixes, and comment-line handling, all against temporary message and spec-root fixtures. `pnpm run verify-doc-budgets` holds the root `AGENTS.md` and `packages/README.md` under their ceilings.
