# @deepseek-ai/dsh-agent-default-model

English | [中文](README.zh.md)

Persistent model selection for the main Agent and deployment-defined named Agent roles. `AgentModelConfig` provides `ctx.agentModels`; direct entry points, Host-backed entry points, and named child tools read one owner instead of carrying unrelated model defaults.

The plugin config requires `{ provider, model }` and accepts `reasoningEffort`. The provider is fixed by composition for every Agent role. The `agent-models` Settings section stores only each role's model and optional reasoning effort, so a graphical change cannot silently move an Agent to another credential or provider route.

- `currentSelection(id?)` returns the effective selection for the main Agent or one registered role.
- `optionsFor(id, fallback?)` applies a role selection while preserving unrelated Agent options such as output limits.
- `registerTarget(target)` contributes a named role for the lifetime of its plugin scope. A visible addition or final removal publishes `agent-models/directory-updated`; equivalent contributions coalesce without publishing duplicate changes, and conflicting definitions fail.
- `saveSelection(selection)` persists a main-Agent switch when a settings provider is mounted.
- The generated `agentModels.list/save/reset` Remote namespace backs the Settings > Agents page with exact model metadata and compare-and-swap revisions.

Every graphical save validates the exact model and reasoning effort through `ctx.llm` before writing. A stale settings revision is rejected instead of overwriting a concurrent edit. Removing an override restores that role's composition default.

## Model Experience

Indirectly, through the selection passed to a subsequently created Agent; the service adds no prompt content.

#### KV Cache effect

Existing Agents and sessions keep their logged selection. A saved change applies to future Agent starts and does not invalidate an established request prefix.

## Known Limitations and Deferred Work

- The provider route is deployment-owned and cannot be changed from the graphical page.
- Named roles appear only while their contributing plugins are mounted; open clients re-read the directory when that live set changes.
- Without a writable settings provider, the directory remains readable but changes cannot be retained.
