# @deepseek-ai/dsh-agent-default-model

Persistent model selection for the main Agent and deployment-defined named Agent roles. `AgentModelConfig` provides `ctx.agentModels`; direct entry points, Host-backed entry points, and named child tools read one owner instead of carrying unrelated model defaults.

The plugin config requires a fallback `{ provider, model }`, accepts `reasoningEffort`, and can map preset ids under `presets` to independent `{ provider, model, reasoningEffort?, label? }` main-Agent routes. Composition fixes the provider independently for every target. The `agent-models` Settings section stores only each target's model and optional reasoning effort, so a graphical change cannot silently move an Agent to another credential or provider route.

- `currentSelection(id?)` returns the effective selection for the main Agent or one registered role.
- `mainSelection(presetId?)` returns the preset-specific main-Agent selection, falling back to the deployment-wide main route when no assignment exists.
- `optionsFor(id, fallback?)` applies a role selection while preserving unrelated Agent options such as output limits.
- `registerTarget(target)` contributes a named role for the lifetime of its plugin scope. A visible addition or final removal publishes `agent-models/directory-updated`; equivalent contributions coalesce without publishing duplicate changes, and conflicting definitions fail.
- `saveSelection(selection, presetId?)` persists a switch under the effective preset's main-Agent target when a settings provider is mounted.
- The generated `agentModels.list/save/reset` Remote namespace backs the Settings > Agents page with each target's fixed provider, the distinct required catalogs, exact model metadata, and compare-and-swap revisions.

Every graphical save validates the exact model and reasoning effort through `ctx.llm` before writing. A stale settings revision is rejected instead of overwriting a concurrent edit. Removing an override restores that role's composition default.

## Model Experience

Indirectly, through the selection passed to a subsequently created Agent; the service adds no prompt content.

#### KV Cache effect

Existing sessions keep their logged selection. A saved change applies to later starts and blank sessions whose effective preset selects that main-Agent target, without invalidating an established request prefix.

## Known Limitations and Deferred Work

- Each target's provider route is deployment-owned and cannot be changed from the graphical page.
- Named roles appear only while their contributing plugins are mounted; open clients re-read the directory when that live set changes.
- Without a writable settings provider, the directory remains readable but changes cannot be retained.
