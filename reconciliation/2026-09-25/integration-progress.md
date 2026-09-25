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

Pending.

## Repairs and validation

Pending.

## Remaining issues

- Reconcile workspace FIFO admission with prepared release lifecycle semantics.
- Repair and qualify eligible Daedal residuals, VM runtime, OpenRouter spending, access hover, and benchmark candidates.
- Validate native-loop documentation claims before retaining any additional commit.
- Linux Incus/Docker/Compose qualification may remain externally blocked if this account cannot access the Incus daemon; do not claim VM runtime qualification without it.
