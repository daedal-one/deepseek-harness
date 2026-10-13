# AGENTS.md

DeepSeek Harness is an all-plugin Cordis agent harness. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Specification workflow

Durable intent lives in `.specs/` using Specs Format v0.7 with Forge Intellect as the evidence provider. Before behavior changes, inspect impact, update or add the accepted TASK, render affected intent for agents, and run `spec lint`. Commits touching specs carry a `Spec-Ref:` trailer; a behavior change with no applicable spec carries `Spec-Ref: none (<reason>)`, and the lefthook commit-msg gate requires the trailer on `feat`/`fix`/`perf` commits. Keep forge-spec authoritative for intent and Forge Intellect for attributable action and adherence evidence.

## Pre-stable APIs and released Session data

Public APIs are pre-stable; update every consumer. [Session version/status](docs/session-format-status.md) defines the authorities. [Adjacent migration](.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md) may add a version-named successor but never move, overwrite, or delete committed generations; predecessors imply neither fallback nor downgrade support. SQLite uses monotonic `SCHEMA_VERSION`.

**Application launch.** Only `dsh` profiles launch supported Node apps; package bins, demos, and public SDK argv escapes are forbidden ([rule](docs/architecture.md#application-launch)).

## Repository layout

```
vendor/      Vendored Cordis source (see vendor/README.md)
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  acp/                  automation-only Agent Client Protocol server
  api/                  Remote BFF assembly + Typert RPC gateway
  artifact/             immutable Workspace outputs + rendering
  attachment/           durable image attachments
  boot/                 shared app-bin boot glue
  bundle/               installable dsh --profile patch layers
  client/               Web-GUI browser half
  code-runtime/         code-execution seam + provider
  compaction/           compaction seam + basic provider
  context/              request-context plugins
  core/                 product API spine: session, tools, agent, loop
  credentials/          credential/authorization seams + providers
  e2b/                  E2B POC: sandbox + FS/subprocess adapters
  experimental/         pre-stable private prototypes
  extensions/           agent runtime self-modification
  feedback/             recorded human feedback
  fs/                   filesystem seam, policy, file tools
  goal/                 same-session goal persistence + lifecycle
  guard/                loop-hygiene + tool-timeout plugins
  hooks/                Claude Code/Codex hook bridges
  host/                 Web-GUI host half: API + route server
  identity/             anonymous shared identity
  integration/          external execution integrations
  interaction/          approvals, permissions, commands, ask-user
  jobs/                 background-job runtime + job-control tools
  llm/                  LLM seam + provider adapters
  lsp/                  language-server seam + stdio provider
  mcp/                  external MCP servers as native tools
  memory/               durable reviewed memory
  plan/                 plan mode as logged state
  preset/               per-session composition from preset files
  runtime-diagnostics/  package-owned runtime invariant checks
  sandbox/              process-confinement seam + backends
  schedule/             session-local scheduled follow-ups
  sdk/                  JSON-RPC protocol + TypeScript client/server
  session/              durable session data plane
  session-query/        session retrieval and search
  settings/             user-settings seam + file provider
  shell/                bash seam + local/pwsh providers
  skill/                provider registry + loader tool
  spill/                spill seam + local impl + result policy
  storage/              non-session storage hub + backends
  subagent/             subagent seam + providers + tools
  subprocess/           subprocess seam + process-tree provider
  terminal/             persistent PTY sessions
  test-support/         dev/test infrastructure
  todo/                 todo_write tool
  typert/               type graph generator + runtime registry
  util/                 zero-dependency utilities
  web/                  web seam + search/fetch providers
  webhook/              webhook ingress
  workflow/             workflow seam + worker-thread engine
  workspace/            Workspace entity
python/      Python SDK/runtime (python/README.md)
native/      node-addon-system source of record (see native/README.md)
benchmarks/  performance gates
.agents/     Agent workflows and Agent Notes (`notes/`)
docs/        architecture, catalogs, postmortems, cookbook (see docs/AGENTS.md)
scripts/     gates and generators
website/     VitePress projection of English docs/ sources
```

Package groups: [packages/README.md](packages/README.md).

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean           # remove build outputs and stale residue
pnpm run test           # unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without DEEPSEEK_API_KEY
pnpm run test:expected  # owner-local process expectations
pnpm run test:snapshot  # keyless recorded-session replay
pnpm run test:snapshot:record  # re-record expected outputs
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run hygiene        # publint + workspace/package/dependency checks + NodeNext consumer check
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine); CI owns this signal
pnpm run doc-sync       # all documentation gates (scripts/run-gates.ts)
pnpm run test:docs      # quick documentation checks (no build)
pnpm run website:build  # VitePress build + dead-link check
pnpm dsh --profile headless "task"  # run one task from source (needs key)
pnpm run demo:ptc -- "task"  # headless PTC run (needs key)
```

### Host sandbox failures

If a required `gh`, `pnpm`, build, test, or generator command fails because the sandbox blocks credentials, network, IPC, watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation. Require sandbox evidence; never bypass test failures or the product sandbox.

### Run relevant checks locally

Run checks before pushes via [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report only commands run. After `gh stack sync`, validate immediately; do not merge before checks pass.

- Match evidence to the surface: focused behavior tests, model/user-output snapshots, `doc-sync` for docs, built smokes for published paths, and real-API e2e for providers.
- Never default to the full suite or repeat a passing check for commit or push; CI owns exhaustive coverage and the platform matrix.
- `test:coverage`, not `test`, is the CI coverage gate ([why](docs/testing.md)).

## Secrets / .env

Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Every npm package is `@deepseek-ai/dsh-<name>`; vendored packages are rescoped ([mapping](docs/rescope.md)) and `private: true`. `@deepseek-ai/cordis` is a peerDependency (+ dev) of every harness package.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `dsh` source launch uses tsx's ESM-only hook, keeping every reached module ESM ([contract](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Publish `./invariant` only when independent observations can diverge; otherwise omit its source and wiring and record why in its README ([package invariant rules](packages/AGENTS.md)).
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@dshScopeScan unsupported`. Public service methods document parameters and non-void returns. `SessionEventMap` members are required-on-read by default — unknown types refuse the log unless the event carries `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests ([policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** A package with both Host and Client programs exposes face-specific leaf configs and a solution-only root; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- **Keep comments local.** Do not restate code, explain distant behavior unless locally required, or expand unrelated comments ([rationale](.agents/notes/implemented/process/2026-08-09-concrete-prose-names-actors-and-recorded-facts.md)).
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Non-trivial changes MUST include an Agent Note in the same PR;** only mechanical/local edits are exempt ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
- **Client UI copy is locale-owned.** Route product text through typed dictionaries and `t` or localized primitive props; `verify-client-ui-i18n` rejects hardcoded copy ([decision](.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
- **Testing policy** — [docs/testing.md](docs/testing.md). Every non-trivial model- or product-user-visible change updates a keyless recorded-session snapshot; [snapshot ownership](snapshots/AGENTS.md) keeps other expected output owner-local. Fixtures replay on macOS/Linux; fix fixtures, not normalizers.
- **Design each tool's UI presentation up front.** Host presenters stay pure; Web cards derive from raw events and persisted result metadata ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; include missing snapshot-harness support in the same change.
- **Both SDKs project the loop.** Agent-loop, session-lifecycle, and `SessionEventMap` changes update the TypeScript and Python SDK expected outputs in the same PR; `pnpm run test` covers neither ([surfaces](docs/testing.md#when-a-snapshot-test-is-required)).
- **Choose PR history deliberately.** Split independent changes and fix the introducing PR before propagation. Standalone/stack branches may merge-forward or rebase. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; preserve an in-progress merge-forward checkpoint before taking a newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every `any` explains why narrowing is infeasible. Modules and exports have JSDoc for non-obvious contracts; function-like exports include `@param`/`@returns`, enforced by `verify-export-jsdoc`. Heritage members, plugin-protocol slots, and constructors keep docs at their declaration.

Comments and docs state complete contracts and context, not reasoning transcripts, control flow, tests, review history, or obvious code. Reserve `contract` for obligations and literal `boundary` for process, wire, security, transaction, or lifecycle divisions; prefer exact terms over vague `shape`. Record behavior, failure, timing, ownership, and safe use; link rationale and use [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) for decisions. Put mechanically checkable invariants in an executed top-level gate, prove invalid acceptance paths reject, and use narrow exceptions instead of global rule suppression.

Docs accompany every code change: update affected README and JSDoc contracts together, per [docs/AGENTS.md](docs/AGENTS.md), which owns current-state prose, one physical line per paragraph, one home per fact, and word budgets.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root and `packages/`; edit the real file. Keep each rule self-contained while linking high-level docs, and raise a `verify-doc-budgets` ceiling only when the required content genuinely needs more space.

## Vendoring policy

`vendor/` packages are pinned source copies; [vendor/README.md](vendor/README.md) owns the manifest, upstream SHAs, and sync procedure. Re-apply or retire the logged local modifications, then rerun `pnpm run test && pnpm run build`.
