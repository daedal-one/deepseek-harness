# Agent Note: Forge adapter spec baseline and extended preflight verification

Status: implemented

## Problem

`@deepseek-ai/dsh-forge-session-adapter` exported `FORGE_SPEC_BASELINE = 'forge-spec-v0.6.0'` while the checked-in tree declares `baseline = "forge-spec-v0.7.0"` in `.specs/_config.toml` and the upstream toolchain stores documents as `forge-spec-v0.7.0` (executable `spec 0.8.0`). Three declarations of one value had drifted, and no gate compared them.

The preflight boundary bound only the rendered bundle: `rendered_sha256` proves the agent render text was not altered in transit, but nothing tied the accepted intent to the committed spec files the render came from or to the checkout revision Forge rendered. A re-render whose sources changed after acceptance stayed invisible.

## Decision

The adapter's accepted baseline is `forge-spec-v0.7.0`, and that literal is the adapter's only authority. The package does not read `.specs/_config.toml` at runtime; the commit-time gate [`verify-forge-spec-baseline`](../../../../scripts/verify-forge-spec-baseline.ts) parses the constant, the spec tree `baseline` value, and the `Specs Format vX.Y[.Z]` phrase in the root `AGENTS.md`, normalizes each to `forge-spec-vX.Y.Z`, and exits non-zero naming every disagreement.

The `forge.spec.preflight/v1` payload gains two optional fields. `specRefs` is a non-empty array of `{ id, digest }`, where `digest` is the lowercase hex SHA-256 of the committed `*.spec.md` bytes. `repoRevision` is a lowercase hex commit id. `parseStartPayload` rejects malformed values at the request boundary and omits both fields when Forge does not send them, so a baseline-only preflight behaves exactly as before.

Two optional adapter configuration fields carry the check. `specsRoot` names the checkout's `.specs` directory, absolute or relative to the process working directory. `repoRoot` names the git checkout root and defaults to the `specsRoot` parent.

`start` verifies the extended preflight after `parseStartPayload` and before `ensureHandle`, so a refused start creates no agent scope. `SPECS_ROOT_REQUIRED` refuses a `specRefs` preflight with no `specsRoot`. `REPO_ROOT_REQUIRED` refuses a `repoRevision` preflight with neither root configured. Verification indexes every `*.spec.md` under `specsRoot` by its frontmatter `id:` line; an unknown id or one id declared by two files refuses as `SPEC_UNRESOLVABLE`, and a file whose bytes hash to something other than the declared digest refuses as `SPEC_RENDER_DRIFT`. `git rev-parse HEAD` runs in the resolved repo root through `node:child_process.execFile`; a different commit refuses as `REPO_REVISION_MISMATCH` and an unreadable HEAD as `REPO_REVISION_UNAVAILABLE`.

A refusal reaches Forge as a failed `start` command response — `status: "failed"`, the mapped outcome, and a `command.failed` event whose message carries the code — because the adapter's command transaction contains start errors. The `git` child is a direct `execFile`, not the `ctx.subprocess` service: the adapter hands its Intellect MCP stdio command to `dsh-mcp-client`, which owns that process, so the adapter has no subprocess capability to inject for a one-shot revision read.

Tests extend `tests/protocol.spec.ts` and `tests/adapter.spec.ts` with a real Cordis composition: extended fields parse and reject malformed values, matching digests and revision start, digest drift, an unresolvable id, a twice-declared id, missing `specsRoot`, missing repo roots, a revision mismatch, and an unreadable HEAD all refuse, and a preflight without extended fields keeps the prior path. This supersedes only the baseline fact in [Forge session adapter and accountable tool plane](2026-08-17-forge-session-adapter.md); that note's adapter decision stands.

## Alternatives considered

**Read `.specs/_config.toml` at adapter runtime.** Rejected because a deployment ships the adapter package and its configuration, not the repository's spec tree. The file would be absent in production, so the adapter would either crash at boot or fall back to a default it cannot verify — exactly the silent skip the fail-closed rule forbids. The constant stays self-contained and a commit-time gate enforces agreement instead.

**Keep binding only the rendered bundle.** Rejected because `rendered_sha256` binds the render text, not the committed spec files behind it. Forge can accept an intent, the spec sources can change, and a later render of the same work item still matches nothing the adapter can check.

**Shell out to the `spec` CLI to verify the tree.** Rejected because it adds a runtime dependency on a binary deployments may not install, and the mechanisms differ: the adapter needs a byte-level digest comparison plus an id lookup, not grammar parsing, lint, or refinement resolution.

**Require the extended fields.** Rejected because it breaks every existing Forge caller at once. Optional fields with unchanged absent-field behavior let Forge migrate one integration at a time while each migrated caller gets a stricter check.

## Consequences

The adapter fails closed on committed-intent drift, so a deployment that sends `specRefs` or `repoRevision` must mount the checkout at the matching revision and configure `specsRoot` (and `repoRoot`, unless it is the `specsRoot` parent). That is a new deployment obligation; omitting both extended fields on the wire avoids it and keeps the pre-0.7 contract.

Id resolution reads a frontmatter `id:` line only. It does not parse Forge Spec grammar, follow `refines`, or lint the tree, so a syntactically valid file with semantically wrong content still passes when its bytes match the digest Forge declared. The digest check is the guarantee; the id lookup is resolution, not validation.

The gate is standalone and the parent wires it into `scripts/run-gates.ts`. Because it compares three textual declarations rather than the adapter's runtime behavior, a build that ships a stale constant with a matching `_config.toml` is caught by the adapter's own tests, not by this gate.
