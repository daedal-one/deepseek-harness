---
id: TASK:llm/daedal-subagent-model-selection
type: task
status: accepted
summary: Let both Daedal reference presets select a child route and reasoning effort, with the reference host authorizing the delegated routes by default.
owners: [carlo]
progress: done
addresses: []
labels: [llm, daedal, subagents, configuration]
assignee: carlo
---

# Daedal subagent reasoning effort

## Scope

Both Daedal reference presets expose only fixed per-role reasoning efforts, and their primary `subagent` definition never enables `modelSelectionSettings`, so a parent Agent receives no `provider`, `model`, or `reasoning_effort` field and no `list_subagent_models`. Enable model-selected delegation on the primary `subagent` definition of `preset/` and `preset-openai/`, keep `subagent_fork` fixed-route, and seed the reference host's `subagent-model-selection-settings` deployment default with the exact routes the named roles already delegate to. Do not change the shipped product presets, the authorization model, or any package source.

## Acceptance

Each reference preset enables selection on exactly its primary `spawn` `subagent` row and enables it nowhere else. The host patch's `subagent-model-selection-settings` config validates against the package schema, is enabled, carries the three GPT-6 `openai-codex` routes plus the four OpenRouter role routes without duplicates, and authorizes every `agentOptions` route both presets delegate to. Documentation states the capability and the fixed-route fork exception.

## Verification

`scripts/daedal-subagent-model-selection.spec.ts` reads the two preset compositions and the host patch, asserts the single enabled row per preset, the unchanged fork row, schema-validated enabled policy, route uniqueness, and superset coverage of the delegated role routes. `scripts/daedal-openai-models.spec.ts` and `scripts/doc-standard.spec.ts` pass beside it, as do the markdown link, wrap, reference, budget, and Agent Note format and classification gates. `spec lint` was unavailable in this environment because the forge-spec CLI is not installed.

The reference files are a version-controlled copy; a running Host picks the change up only after the preset directories are copied and the patch is merged.
