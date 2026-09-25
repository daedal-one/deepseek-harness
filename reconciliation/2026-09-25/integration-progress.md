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
- `0c887e778a` ports exact benchmark candidate `1f61cb40d25c667f450bd06321b067e72505f192` under a completed, accepted benchmark intent rather than retaining its WIP commit label.
- `d884d4134a` integrates exact OpenRouter turn-3 candidate `a8620a9fc2c69eac5e41db4560b12b78266b0ab9` with pricing, attribution, credential-cache, limit-display, Loader-profile, and keyless expected-output repairs; turn-2 remains superseded.
- `6fee7a5327` selectively ports exact access-hover candidate `e9f3c858dafb1605e9e4e856fc6fc96c74b3a45a` over the newer environment-aware `PermissionSelect` without restoring its old generic selector.

## Repairs and validation

- Workspace admission resolution preserves host identity/world checks and host bypass, environment and multi-repository grants, provenance, `close()`/`registerWorkspaceOwner`, settlement ordering, lazy allocation, FIFO capacity, parent/child ownership, per-owner use, cancellation-aware operations, durable admission status, quiescent checkpoint-before-release, resumed waiter cancellation, and target namespaces.
- Follow-up review repaired host `runForSession`, lazy environment guidance, pre-turn cancellation capacity release, cold repository requests, pending-status flush retry scheduling, and stale portable/client tests.
- Daedal residual repair hydrates search summaries outside the retained page before rendering, refuses mismatched caller-owned fork identities, and observes late listener rejection after per-event cancellation.
- OpenRouter repair rejects blank prices, prices only child-owned settled usage at durable actual routes, refuses unsupported mixed/unattributed history, clears successful-only caches on credential changes or disappearance, retains actual fetch time, preserves catalog failure classes, withholds Host diagnostics from UI copy, and renders configured and remaining limits separately.
- Access descriptions are locale-owned, prefer host descriptions, preserve environment/policy separation, and state that Full access cannot escape the displayed environment.
- `git diff --cached --check` passed after every conflict resolution. Dependency installs use per-command host temporary storage because a persistent full install exceeds the 1 GiB workspace.
- Daedal focused Vitest: six files, 349 tests passed (`gateway.client`, session manager/service/fork, UI workspace apply/browser).
- OpenRouter focused Vitest: nine files, 120 tests passed after adversarial fixes for credential disappearance, fork-owned usage, catalog failures, locale-only diagnostics, and limits.
- Access tooltip Vitest: three files, 123 tests passed; the final fixed-session focus behavior was rerun in the 120-test combined set.
- Benchmark source-plane Vitest: three files, 80 tests passed. Built benchmark controls remain pending because native/build prerequisites are unavailable.
- Admission helper and environment Vitest: 23 tests passed. The combined `workspaces.spec.ts` cannot initialize because the native flock binding is absent; building it is blocked by missing `musl-gcc`.
- `gen-persistence-catalog`, `verify-persistence-catalog`, and `verify-tsconfig-paths` passed; generated persistence files are current.
- `doc-sync` completed 20 gates and failed 12 under the filtered install: missing unselected workspace dependencies, OOM-killed compiler gates, absent VitePress, and existing export-JSDoc findings. The one candidate-owned tsconfig alias failure was repaired and its focused gate now passes.
- The repository has no installed `spec` command, so `spec lint` is unavailable in this checkout. Targeted typecheck found two spending-client type defects that were repaired; complete typecheck still requires generated Remote artifacts and a full dependency/build environment.

## Remaining issues

- Development VM source repair continues on `daedal/reconcile-20260925-development-vm`; real Incus/Docker/Compose qualification is unavailable because `incus` is absent.
- Run remaining build, generated-Remote, full typecheck, snapshot, and documentation checks through CI or a sufficiently provisioned workspace before any merge.
- OpenRouter exact-head real-profile GIF evidence cannot be captured without deploying/restarting this existing server or starting another server, both prohibited by this task; keep the candidate unmerged if that repository requirement cannot be satisfied externally.
- Native-loop commit `9690b85674` is not eligible to port as written: it is a Forge/spec-only status edit with unavailable deployment evidence and is covered by the explicit Forge/Intellect exclusion.
