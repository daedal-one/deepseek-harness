# Daedal reference setup

A version-controlled reference copy of the Daedal OpenRouter and OpenAI Codex agent presets and the host composition patch that mounts them. The patch owns the host-plane services both presets depend on — model routes, shell and filesystem policy, credential-backed providers, durable memory, and scoped authorization hooks.

The files contain no credentials or personal data. API keys are referenced by environment variable or derived credential reference only, and the memory provider resolves its path through `dshHomePath()` at load time.

## Layout

- [preset/](preset/) — the OpenRouter preset, mirroring `~/.dsh/.agent-presets/daedal/`:
  - [agent.cordis.yml](preset/agent.cordis.yml) — the agent-plane composition: persona, english-output-guard, memory extractor, tools, and the named role subagents.
  - [preset.yml](preset/preset.yml) — the preset metadata (id is the directory name).
  - [roles/](preset/roles/) — the role prompt files; `agent.cordis.yml` loads them by relative `roles/` URL, so the directory must stay beside the composition. The prompt text is copied verbatim apart from markdown-structure normalization: a nested lettered list in `researcher.md` is rendered as a bullet list (letters kept inline) so the files parse under the repository's Markdown gate.
- [preset-openai/](preset-openai/) — the self-contained OpenAI Codex counterpart, mirroring `~/.dsh/.agent-presets/daedal-openai/`; it keeps its own role files so either preset can be installed independently.
- [host/cordis.patch.yml](host/cordis.patch.yml) — the host-plane composition patch shared by the Web and headless profiles (`~/.dsh/profiles/web/cordis.patch.yml` and `~/.dsh/profiles/headless/cordis.patch.yml` carry identical content).

## Installing

Copy `preset/` to `~/.dsh/.agent-presets/daedal/`, copy `preset-openai/` to `~/.dsh/.agent-presets/daedal-openai/`, and merge `host/cordis.patch.yml` into each profile's `cordis.patch.yml`. The host composition stays authoritative for registries, sandbox and approval stack, persistence, and model routes; each preset contributes only agent-plane rows.

After the Web profile starts, open Settings > Models, add or open **OpenAI Codex**, and choose **Sign in**. The native pi-ai route uses OpenAI's device-account flow and stores the resulting credential through the shared credential service; it does not require an `OPENAI_API_KEY`. OpenAI documents ChatGPT-account and API-key authentication as separate Codex sign-in methods in [Codex authentication](https://developers.openai.com/codex/auth).

## Permission modes

The host patch declares the permission table in UI order: Read Only, Workspace Write, Policy reviewed, and Full access. Policy reviewed uses `danger-full-access` file permissions with the interactive `ask` approval policy, and the tool-policy enforcer runs only for that exact pair. Read Only and Workspace Write retain their file sandbox without auxiliary policy requests; Full access retains `danger-full-access` with approval prompts disabled and bypasses auxiliary policy requests. Policy providers cover the configured shell and scoped MCP calls; tools unsupported by those providers continue under their own enforcement mechanisms.

## Deployment-specific names

The preset references validators (`daedal-implementer-status`, `daedal-review-verdict`) and principals (`daedal-researcher`, `daedal-browser-reader`, `daedal-browser-operator`, `daedal-crawler`, `daedal-web-debugger`, `daedal-memory-reviewer`) that the deployment registers in its host composition — the result-status validators through [`dsh-subagent-result-status-block`](../../../packages/subagent/subagent-result-status-block/README.md) and the tool-policy principals through the patch's `daedal-tool-policy-*` rows. This repository does not register them; a copy that omits the host patch leaves those names unresolved.

## Model routes

The existing `daedal` preset keeps its OpenRouter defaults, including `qwen/qwen3.8-27b` for `coder`. The `daedal-openai` main Agent and implementation/research roles use GPT-5.6 Terra, difficult reasoning and review roles use GPT-5.6 Sol, and bounded browser, crawler, translation, and extraction roles use GPT-5.6 Luna. The host fixes each target to its provider while Settings > Agents can still change that target's model and reasoning effort within the assigned catalog. See OpenAI's current [model catalog](https://developers.openai.com/api/docs/models) for the Sol, Terra, and Luna positioning.

Tool-policy classifiers remain host-owned and keep their independent OpenRouter routes in this reference. They review supported shell and MCP calls for either preset and are not part of the selected Agent's model route.
