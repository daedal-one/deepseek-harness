# Agent Note: Repository spec lint gate

Status: implemented

## Problem

Durable intent lives in `.specs/` under Specs Format v0.7, and `AGENTS.md` requires `spec lint` before behavior changes. The forge-spec CLI is not installed in this environment, so the spec tree had no executed gate: frontmatter fields, lifecycle vocabulary, and cross-references were validated by inspection. That drift was already visible — 62 documents spelled `progress: done` while 24 used `completed`, `complete`, `doing`, or `in_progress`, and one document carried a bare `blocked_by:` key that parses as null.

## Decision

[`scripts/spec-lint.ts`](../../../../scripts/spec-lint.ts) validates every `.specs/**/*.spec.md` document and `.specs/_config.toml` against the baseline the config declares. It reads frontmatter with `js-yaml` and the config with `smol-toml`, both already used by sibling scripts, so the gate adds no dependency.

The gate owns the mechanically checkable document contract, not the semantic graph. It rejects unparsable frontmatter; missing or mistyped `id`, `type`, `status`, `summary`, `owners`, or type-required fields; an id whose prefix, area, or slug disagrees with its type, directory, or filename stem; `status`, `progress`, or `level` values outside the upstream enums; a `refines`, `addresses`, or `blocked_by` entry that names no document; a clause anchor that no `{#c-...}` marker or typed-block id declares; a `blocked_by` entry that is not a task; and a config baseline outside `forge-spec-v<major>.<minor>.<patch>` or a project id that resolves to no `project` document. Refinement cycles, level monotonicity, clause coverage, redirects, and documentation enrollment remain with forge-spec.

Diagnostics are `file:line` records on stderr with a non-zero exit; a clean tree prints nothing. The gate is `pnpm run spec-lint` and sits beside `verify-md-links` in the documentation quick lane of [`scripts/run-gates.ts`](../../../../scripts/run-gates.ts), so `pnpm run test:docs` covers it without a build.

The normalization that made the tree pass is mechanical only: seven tracked documents moved to the canonical `progress` spelling, and no body prose changed.

## Alternatives considered

**Invoke the forge-spec CLI from the gate.** The authoritative toolchain implements every rule, but it is not installed here, and an unavailable binary turns the gate into a skip. The repository gate must execute in this checkout.

**Use a YAML parser that reports duplicate keys and line numbers.** `js-yaml` is already a workspace dependency and its listener exposes each frontmatter key's line, which is what the diagnostics need. Adding another parser for duplicate-key detection alone does not earn its dependency.

**Enforce the full upstream rule set, including the semantic graph.** Cycles, coverage, and level monotonicity need the complete refinement graph and a policy for warnings versus errors. That scope belongs to forge-spec; this gate would then disagree with it.

**Rename spec files whose id slug disagreed with their stem.** Two of the three mismatches sit in documents owned by another change and one is a prose-level rename, so the gate reports them as findings instead of rewriting intent.

## Consequences

The spec tree now fails `pnpm run test:docs` when a document's frontmatter, identity, or references drift, and the accepted TASK [`repo-spec-lint`](../../../../.specs/tasks/repo-spec-lint.spec.md) records the contract. A new spec file must keep its id slug equal to its filename stem and its area equal to its directory, which is stricter than upstream: upstream treats directory layout as convention, while this gate enforces it for `REQ` and `IFC` documents and for tasks outside `.specs/tasks/`.

The gate does not resolve `spec:` links, `_redirects.toml`, or `summary` requirements on referenced documents, so it is a floor rather than a replacement for `spec lint`. Three tracked task documents carried an id slug that disagreed with their filename stem and were renamed to the id rather than re-identified: `.specs/tasks/durable-mvp-plus.spec.md`, `.specs/tasks/forge-runtime.spec.md`, and `.specs/tasks/network-access.spec.md`.
