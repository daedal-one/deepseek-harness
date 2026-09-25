# Branch reconciliation progress — 2026-09-25

## Scope

Integration branch `daedal/reconcile-20260925-integration` starts from refreshed `origin/master` `452c2e3e16ecde300bfad142dc4286f83c0a02e3` in the isolated worktree `.dsh-worktrees/reconcile-20260925`.

Explicit exclusions remain unmerged: `codex/customizable-harness-branding`, `codex/forge-agent-runtime-main`, `codex/forge-browser-integration`, `codex/deadal-intellect-profile`, and every residual Forge/Intellect change. Recovery branch `codex/reconcile-20260925/snapshots` is evidence only and is not a product merge candidate.

No deployment, service restart, branch deletion, force push, or hook bypass is authorized or performed.

## Ref verification

Fetched `origin` with pruning and tags before integration. Verified these candidate tips:

- `origin/master`: `452c2e3e16ecde300bfad142dc4286f83c0a02e3`
- `origin/codex/host-handoff-release-20260925`: `61ffa1c53d0085bf6d87af7df90da2ae1efc4b6b`
- `origin/codex/daedal-dsh`: `7c9f5a3779e4f3d3b0ba8a260a0f45f6c463eb31`
- `origin/codex/reconcile-20260925/local-master`: `aa7efccb559bf20fc415322d132c64e0a5a03cc8`
- `origin/codex/development-vm`: `42d1e4a50e597e75c370d653c9612fce10a506e5`
- `origin/codex/native-loop-main-host`: `9690b856743ab04559696597cfac800fe5676293`
- OpenRouter turn-3: `a8620a9fc2c69eac5e41db4560b12b78266b0ab9`
- Access hover: `e9f3c858dafb1605e9e4e856fc6fc96c74b3a45a`
- `origin/feat/benchmarking`: `1f61cb40d25c667f450bd06321b067e72505f192`
- Recovery snapshot: `b06cba01332968af6f0beaa6b29162bd0316cf5b`

## Duplicate and superseded decisions

- OpenRouter turn-3 aliases are equal-tip; integrate at most `a8620a9fc2c69eac5e41db4560b12b78266b0ab9` after repairs. Do not merge turn-2 `5541613ddcb`.
- Access-hover refs at `e9f3c858daf` are duplicates; selectively port only residual locale-owned descriptions and tooltip behavior over current profile-aware UI.
- `codex/host-maintenance`, `codex/profile-access-ui`, `codex/deploy-daedal-styling`, and historical Paseo work have adapted counterparts in master/prepared release; do not merge older implementations wholesale.
- `codex/reconcile-20260925/local-host-maintenance-server` is preserved but not a wholesale candidate over the prepared release.
- Dirty snapshot patches were audited previously and contain no eligible source change unique to recovery material; do not apply them blindly.

## Imported commits

- `27001edeba` merges exact prepared release tip `61ffa1c53d0085bf6d87af7df90da2ae1efc4b6b` while retaining refreshed master.
- `f16990b36f` merges exact Daedal tip `7c9f5a3779e4f3d3b0ba8a260a0f45f6c463eb31`.
- `ad1132bb56` merges exact local admission tip `aa7efccb559bf20fc415322d132c64e0a5a03cc8` with semantic conflict resolution over the prepared release.
- `d960250068` completes off-page search hydration, caller-owned fork result identity validation, and cancellation-observation regression coverage.
- `47b864a467` closes combined admission lifecycle gaps found by adversarial post-merge review.

## Repairs and validation

- Workspace admission resolution preserves host identity/world checks and host bypass, environment and multi-repository grants, provenance, `close()`/`registerWorkspaceOwner`, settlement ordering, lazy allocation, FIFO capacity, parent/child ownership, per-owner use, cancellation-aware operations, durable admission status, quiescent checkpoint-before-release, resumed waiter cancellation, and target namespaces.
- Follow-up review repaired host `runForSession`, lazy environment guidance, pre-turn cancellation capacity release, cold repository requests, pending-status flush retry scheduling, and stale portable/client tests.
- Daedal residual repair hydrates search summaries outside the retained page before rendering, refuses mismatched caller-owned fork identities, and observes late listener rejection after per-event cancellation.
- Source and focused tests are present, but no package tests have run yet because this worktree has no dependencies and `pnpm` is not installed as a standalone binary. Dependency/tool bootstrap remains pending.

## Remaining issues

- Repair and qualify eligible VM runtime, OpenRouter spending, access hover, and benchmark candidates.
- Native-loop commit `9690b85674` is not eligible to port as written: it is a Forge/spec-only status edit with unavailable deployment evidence and is covered by the explicit Forge/Intellect exclusion.
- Linux Incus/Docker/Compose qualification is currently unavailable because `incus` is absent; do not claim VM runtime qualification without it.
