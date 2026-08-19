# Daedal reference setup

A version-controlled reference copy of the Daedal agent preset and the host composition patch that mounts it. The preset defines an OpenRouter-first coding agent with named subagent roles; the patch owns the host-plane services the preset depends on — the model route, shell and filesystem policy, credential-backed providers, durable memory, and the scoped authorization hooks.

The files contain no credentials or personal data. API keys are referenced by environment variable or derived credential reference only, and the memory provider resolves its path through `dshHomePath()` at load time.

## Layout

- [preset/](preset/) — the agent preset, mirroring `~/.dsh/.agent-presets/daedal/`:
  - [agent.cordis.yml](preset/agent.cordis.yml) — the agent-plane composition: persona, english-output-guard, memory extractor, tools, and the named role subagents.
  - [preset.yml](preset/preset.yml) — the preset metadata (id is the directory name).
  - [roles/](preset/roles/) — the role prompt files; `agent.cordis.yml` loads them by relative `roles/` URL, so the directory must stay beside the composition. The prompt text is copied verbatim apart from markdown-structure normalization: a nested lettered list in `researcher.md` is rendered as a bullet list (letters kept inline) so the files parse under the repository's Markdown gate.
- [host/cordis.patch.yml](host/cordis.patch.yml) — the host-plane composition patch shared by the Web and headless profiles (`~/.dsh/profiles/web/cordis.patch.yml` and `~/.dsh/profiles/headless/cordis.patch.yml` carry identical content).

## Installing

Copy `preset/` to `~/.dsh/.agent-presets/daedal/` (the directory name is the preset id) and merge `host/cordis.patch.yml` into the profile's `cordis.patch.yml`. The host composition stays authoritative for registries, sandbox and approval stack, persistence, and the model route; the preset contributes only the agent-plane rows.

## Permission modes

The host patch declares the permission table in UI order: Read Only, Workspace Write, Policy reviewed, and Full access. Policy reviewed uses `danger-full-access` file permissions with the interactive `ask` approval policy, and the tool-policy enforcer runs only for that exact pair. Read Only and Workspace Write retain their file sandbox without auxiliary policy requests; Full access retains `danger-full-access` with approval prompts disabled and bypasses auxiliary policy requests. Policy providers cover the configured shell and scoped MCP calls; tools unsupported by those providers continue under their own enforcement mechanisms.

## Deployment-specific names

The preset references validators (`daedal-implementer-status`, `daedal-review-verdict`) and principals (`daedal-researcher`, `daedal-browser-reader`, `daedal-browser-operator`, `daedal-crawler`, `daedal-web-debugger`, `daedal-memory-reviewer`) that the deployment registers in its host composition — the result-status validators through [`dsh-subagent-result-status-block`](../../../packages/subagent/subagent-result-status-block/README.md) and the tool-policy principals through the patch's `daedal-tool-policy-*` rows. This repository does not register them; a copy that omits the host patch leaves those names unresolved.

## Model routes

Each role names its own OpenRouter route. The `coder` role runs `qwen/qwen3.8-27b`; the persona template resolves `{{model}}` from the agent's route. The english-output-guard translates drift with a separate translator route, and the memory extractor and tool-policy classifiers route independently of the roles.
