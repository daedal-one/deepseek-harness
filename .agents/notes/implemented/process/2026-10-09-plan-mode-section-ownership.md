# Agent Note: Plan-mode section ownership

Status: implemented

## Problem

The model-facing plan-mode policy text lived as YAML `section:` literals in five hand-edited places: the base bundle patch ([`packages/bundle/base/cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml)) and the four compositions that restate it — [`standard`](../../../../packages/preset/agent-presets/presets/standard/agent.cordis.yml), its generated `ptc` and `cordis` variants, and the Daedal reference preset. Four of those copies carried one sentence — "those tools remain listed to keep the tool catalog unchanged" — while the base patch carried "those tools remain listed only to keep the request shape stable", so the copies had already drifted. Editing the policy meant editing every copy, and the drift proved that copies are not kept in step.

The same shape applied to [`dsh-compaction-tool-result-pruner`](../../../../packages/compaction/compaction-tool-result-pruner/README.md): the plugin already owned `DEFAULTS` and schema defaults of `8192`/`4096`/`1024`, and the base patch and preset rows restated those numbers. The [agent-presets README](../../../../packages/preset/agent-presets/README.md) also named a `code` preset that the shipped set no longer contains (`standard`, `minimal`, `ptc`, `cordis`).

## Decision

[`@deepseek-ai/dsh-plan-mode`](../../../../packages/plan/plan-mode/src/index.ts) exports `PLAN_MODE_SECTION` — the base-patch prose verbatim, including its trailing newline — and declares it as the `static Config` schema default on `PlanModeController`. An omitted `config.section` therefore renders that exact text, and `PlanModeConfig.section` is optional. `resolveConfig` applies the same default for direct construction, so tests and in-process callers do not depend on Loader normalization. The base bundle patch's `plan-mode` row and the `standard` preset's `plan-mode` row now carry only `id` and `name`.

The base-patch prose is canonical. The one drifted sentence in the preset copies harmonizes to it, so the `standard` preset's rendered policy changes by that sentence; the generated `ptc` and `cordis` presets keep their literal copies until the next `pnpm run gen-agent-preset-variants` run, because a concurrent change stream owned that generator and those files during this change.

The `tool-result-pruner` base-patch row drops `thresholdChars`/`headChars`/`tailChars`; the plugin's existing `DEFAULTS` and schema defaults were already the shipped values, so no source change was needed there. The agent-presets README now names `ptc` and `cordis` instead of the removed `code` preset and states that persona strings stay restated per preset as deployment-owned prompt text.

## Alternatives considered

**A preset-baseline include mechanism.** A `standard` row could be included into `ptc` and `cordis` by reference instead of materialized, which would give the policy text one source for all shipped presets. It lost because the preset layer deliberately distributes complete, self-contained composition files: [`dsh-agent-presets`](../../../../packages/preset/agent-presets/README.md) documents copy-based authoring, a mounted subtree is resolved from one file, and the variants exist precisely to materialize the finite derived set. Adding include semantics would change the preset format and the mount contract to delete a handful of literals.

**A shared constant imported by the YAML files.** The base patch and presets could reference one exported string through a `!!js` expression. It lost because `!!js` under `config` is a deployment expression evaluated in the Loader context, not a module import, and because it would put code evaluation into composition files that are otherwise literal data.

**Leave the literal in the base patch and default only the presets.** It lost because the base patch is the shared layer every base-backed profile mounts; defaulting at the plugin and deleting the literal at the only hand-edited shipped site is the single home the review asked for.

**Keep `section: string` required while the schema defaults it.** It lost because the exported config type is the deployment-axis reference: a required field would tell TypeScript callers and the generated configuration catalog that a value the schema supplies is mandatory.

**Also dedupe persona strings.** It lost because a persona is deployment-owned prompt text that a deployment is expected to replace wholesale; unlike the plan policy, it has no single shipped value, so a shared default would not delete a meaningless copy.

## Consequences

The policy text now changes in one place, and a fixture test in [`section-default.spec.ts`](../../../../packages/plan/plan-mode/tests/section-default.spec.ts) pins the rendered `plan:policy` section byte-for-byte against the old base-patch prose. Sessions composed from the `standard` preset see the base-patch sentence instead of the drifted preset sentence, a one-sentence model-visible change; no keyless recorded-session snapshot records the plan policy text, so none needed re-recording.

The `ptc` and `cordis` generator outputs are stale against the edited `standard` source and must be regenerated in a change stream that owns them. Two unowned documents still describe the old shape: [`docs/config-catalog.md`](../../../../docs/config-catalog.md) pastes the config declaration and its source pointer, and [`docs/subsystems/plan.md`](../../../../docs/subsystems/plan.md) holds a `ts type-equiv` copy of `PlanModeConfig` plus prose saying a missing `section` fails. Both need regeneration or edits by their owners.
