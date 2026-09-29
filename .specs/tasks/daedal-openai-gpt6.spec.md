---
id: TASK:llm/daedal-openai-gpt6
type: task
status: accepted
summary: Serve GPT-6 Astra, Sol, and Luna through the native Codex route and preserve Daedal role tiers.
owners: [carlo]
progress: done
addresses: []
labels: [llm, daedal, configuration]
assignee: carlo
---

# Daedal OpenAI GPT-6 routing

## Scope

Keep the account-authenticated Codex Responses route and existing OpenRouter selections. Make GPT-6 Astra, Sol, and Luna available without removing models needed by saved conversations. Map GPT-5.6 Sol roles to GPT-6 Astra, Terra roles to GPT-6 Sol, and Luna roles to GPT-6 Luna. Preserve supported reasoning efforts; map minimal to low for the new models.

## Acceptance

The reference host and preset configuration resolve all three GPT-6 models. The existing server exposes them in its authenticated catalog, preserves credentials, and uses the requested models in real short tool-using checks. Save deployment backups, record the effective model choices and evidence, and avoid restarting unrelated conversations. Historical Session logs and snapshot generations remain unchanged.

## Verification

On 2026-09-29, the existing main server completed one read-only turn for each model through `openai-codex`, with reasoning effort `low`. Sessions `qualification-gpt-6-astra-20260929`, `qualification-gpt-6-sol-20260929`, and `qualification-gpt-6-luna-20260929` each read the first five lines of `/workspace/deepseek-harness/AGENTS.md`, recorded a successful tool result with those lines, returned `GPT6_TOOL_OK`, and ended with `completed`. This proves short tool use, not model quality, maximum context, or every reasoning effort.

Repeat through the existing server: select each exact model with `low` reasoning in a fresh Daedal-OpenAI conversation; request one read of those five lines without edits or delegation; inspect the recorded request model, returned file lines, and completed turn. Do not treat the marker alone as success. The original OpenAI preset files are retained in `/home/carlo/.local/share/dsh-server/recovery/openai-gpt6-raIIf9`.

`pnpm exec vitest run scripts/daedal-openai-models.spec.ts packages/llm/llm-pi-ai/tests/config.spec.ts packages/llm/llm-pi-ai/tests/catalog.spec.ts` passed 86 tests on the server qualification checkout using the installed Vitest executable directly. The reference configuration tests check catalog preservation, native Codex protocol, GPT-6 capacity declarations, and removal of unsupported minimal reasoning from the OpenAI preset.
