---
id: TASK:process/repo-spec-lint
type: task
status: accepted
summary: Validate the .specs tree against the declared Specs Format baseline and normalize its lifecycle vocabulary.
owners: [carlo]
progress: done
addresses: []
labels: [process, specs, gates]
assignee: carlo
---

# Repo-local spec lint

## Acceptance

`scripts/spec-lint.ts` validates every `.specs/**/*.spec.md` document and `.specs/_config.toml` against the baseline declared in the config. It rejects unparsable frontmatter, a missing or mistyped required field, an id whose prefix, area, or slug disagrees with the document type, path, or filename stem, a status or progress value outside the upstream enum, a reference that names no document or clause anchor, a `blocked_by` entry that is not a task, and a config whose baseline or project id does not resolve. It exits non-zero with `file:line` diagnostics and prints nothing when the tree is clean.

The gate is registered as `pnpm run spec-lint` and in the documentation quick lane of `scripts/run-gates.ts`, so `pnpm run test:docs` covers the spec tree without a build.

The normalization that made the tree pass is mechanical only: every `progress` spelling outside the upstream enum maps to its canonical value, and no document body changed.
