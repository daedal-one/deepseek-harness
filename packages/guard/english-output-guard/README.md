# @deepseek-ai/dsh-english-output-guard

A scoped output policy for deployments whose selected model routes may drift into Han-script prose. It adds an English instruction to the scoped system prompt and wraps `llm/stream`; auxiliary calls and routes not listed in `targets` delegate immediately, while a targeted successful agent-loop response is buffered until its finish is known. Error and aborted responses replay byte-for-byte. A successful response without substantial unprotected Han also replays byte-for-byte, including provider `replayState`.

## Config

Every deployment-varying choice is required; invalid, duplicate, blank, non-positive, or out-of-range values fail at plugin load.

```yaml
- id: english-output-guard
  name: '@deepseek-ai/dsh-english-output-guard'
  config:
    targets:
      - provider: openrouter
        model: deepseek/deepseek-v4-flash-0731:nitro
    translator:
      provider: openrouter
      model: moonshotai/kimi-k2.7-code
    hanMinChars: 2
    hanRatio: 0.2
    maxTranslationInputChars: 32000
    maxOutputTokens: 4096
    timeoutMs: 30000
    failureMode: block
    translationNotice: none
```

`targets` compares the exact `{provider, model}` pair on requests marked by `isAgentLoopRequest`; `sessionId` and `purpose` do not establish ownership. `hanMinChars` and `hanRatio` must both match after protected spans are removed. `failureMode: preserve` replays the original successful stream after a translation failure; `block` replaces each affected prose block with `English output enforcement failed. The non-English prose was withheld.` Cancellation always preserves and lets the agent loop's abort win. `translationNotice: append` adds `[Translated to English.]` to the first changed prose block.

## Buffering and translation

The guard translates `text` and `reasoning` blocks only. Fenced code, inline code, Markdown link destinations, raw URLs, file and path references, command flags, and identifier-like spans become collision-free placeholders before the auxiliary request and must return exactly once. Tool-call ids, names, and raw JSON arguments and all other structured blocks never enter translation. The translator receives one strict-JSON request through `ctx.llm`, under the configured route, output cap, and deadline; the request is explicitly excluded from recursive interception.

A changed response is emitted as one canonical chunk stream in original block order, followed by original usage and finish reason. Provider `replayState` is omitted because it describes different bytes. Translation output must be strict JSON with exactly the expected block indexes and types, non-empty strings, intact placeholders, no substantial unprotected Han, and no extra fields.

## Durable audit

Before translator dispatch, `english-output/translation-request` records the open turn and step, target and translator routes, exact system prompt, messages, output cap, and original affected block content. `english-output/translation-result` records `translated`, `blocked`, or `preserved`, the affected indexes, and only a bounded failure code. These events are log-only: the original drift never becomes an `assistant/chunk` or `assistant/message`; the accepted stream remains the sole canonical UI and model history. The package invariant requires each audit pair to lie inside one open step and requires a canonical assistant message after translated or blocked settlement unless the turn aborts.

Disposal aborts every translator request owned by the plugin and awaits settlement before completing. Buffering adds the complete main-response time plus translation time to first visible output for targeted drift; non-target, failed, aborted, and no-drift streams perform no auxiliary call.

## Model Experience

### Scoped English policy

#### What the model sees

Every request in the plugin's registration scope contains the policy below.

##### English policy section

```markdown
Write all explanatory text and reasoning in English. Keep code, commands, identifiers, paths, URLs, tool names, tool arguments, and quoted source material unchanged.
```

#### Token effect

Fixed retained system-prompt tokens in the scopes where the plugin is mounted.

#### KV Cache effect

Prefix-stable while the scoped roster and policy text remain unchanged.

### Conditional translation request

#### What the model sees

The translator sees a fixed strict-JSON instruction and one capped DATA message containing only affected tokenized prose blocks. The conversational model sees the accepted English blocks or the configured failure text, never the auxiliary request.

#### Token effect

Conditional and capped by `maxTranslationInputChars`, `maxOutputTokens`, and the selected block set. The original main response is already billed even when enforcement blocks it.

#### KV Cache effect

The auxiliary request is independent of the conversation cache. A changed assistant response replaces the provider bytes at the end of model-visible history and omits their replay state; it does not alter the preceding conversation prefix.

## Known Limitations and Deferred Work

- **Buffered presentation** — targeted drift cannot stream incrementally because the finish outcome and complete protected-span set must be known before accepted chunks enter the durable log.
- **Han-triggered only** — other non-English scripts do not activate translation.
- **Text heuristics** — unmarked quoted prose is translatable; only clearly structured spans are protected.
- **No translation replay cache** — resumed sessions use the already accepted assistant message, but an interrupted request cannot reuse a completed auxiliary translation that never reached the canonical stream.
