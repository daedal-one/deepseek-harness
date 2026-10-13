# Agent Note: Daedal reference subagent model selection

Status: implemented

## Problem

The Daedal reference presets were copied from a composition that predates [model-selected subagent routes](2026-08-18-model-selected-subagent-routes.md), so their primary `subagent` definition never set `modelSelectionSettings`. Without that key the tool emits no `provider`, `model`, or `reasoning_effort` fields and registers no `list_subagent_models`, whatever the Host preference says, so a parent Agent could not choose a child route or effort. Every named role was pinned to its configured tier — coder `xhigh`, guru `max`, reviewer `xhigh`, the bounded Luna roles `low` — and those fixed tiers were the only effort control the parent had.

## Decision

Both reference presets put `modelSelectionSettings: true` on the primary `subagent` definition and leave `subagent_fork` fixed-route. Only the primary definition enables it, because the shared `list_subagent_models` name registers once per tool scope and a second enabled row would collide; the named role rows keep their configured tiers.

The reference host patch seeds `subagent-model-selection-settings` with `enabled: true` and one shared route list: the three `openai-codex` GPT-6 routes the `daedal-openai` roles use, plus the four OpenRouter routes the `daedal` roles use. The list is Host-global rather than scoped per preset, so a Session on either preset can select any of the seven. A parent Agent can therefore name an authorized child route and its reasoning effort without a Settings change.

The authorization rule owned by [user-authorized subagent model routes](2026-08-24-user-authorized-subagent-model-routes.md) is unchanged. A newly composed top-level Session records the list it composed with, child Sessions inherit that record, a resumed Session keeps its own record, and Settings > Plugins can narrow or extend the deployment default for Sessions composed later. The deployment base authorizes only routes this reference already pays for; it does not open the live adapter directory.

## Alternatives considered

**Enable model selection on every delegation definition.** Rejected because `list_subagent_models` is a single tool name per tool scope: the second enabled row fails its registration, and the invariant that ties a selectable schema to a discoverable one assumes exactly one.

**Ship the flag and leave authorization to the Plugins preference.** Rejected because the reported gap is an agent that cannot set an effort at all. A default-off deployment answers no better than the missing flag: the model still sees no route fields until someone opens Settings, and the routes a deployment already delegates to are the obvious authorized set.

**Authorize the whole provider catalog.** Rejected because the mechanism deliberately has no unrestricted mode. Authorization is a user or deployment decision about credentials and spend, and a broader default would expand silently as adapters advertise models.

## Consequences

Both presets now keep their fixed role tiers and add an opt-in-per-call route and effort, so a parent can raise or lower a child's thinking effort instead of choosing between the tiers alone. The reference host patch, not the preset documents, carries the route list, because a portable preset must not choose a credential route. Because that list is Host-global, an OpenAI-preset Agent can also delegate to an OpenRouter route and the reverse; a deployment that wants one credential per preset narrows the list in Settings > Plugins.

A deployment installed from these files must copy the preset directories and merge the patch before the change takes effect; a running Host keeps the policy its Sessions already recorded, so existing conversations do not gain the fields until they are composed again. The preset also now depends on the Host's `subagent-model-selection` settings service and refuses to mount without it, which is the same coupling the shipped presets already have. `subagent_fork` deliberately stays outside the policy so its inherited prefix remains eligible for provider-side cache reuse.

`vitest run scripts/daedal-subagent-model-selection.spec.ts` pins the enabled row per preset, the fixed fork row, the host default validated through `SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA`, route uniqueness, and that every route the named roles delegate to is authorized by that default.
