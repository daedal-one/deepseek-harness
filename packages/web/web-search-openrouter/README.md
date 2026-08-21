# @deepseek-ai/dsh-web-search-openrouter

An [OpenRouter](https://openrouter.ai)-backed `WebSearchProvider` for the harness [web capability](../web/README.md). It sends an auxiliary Chat Completions request with OpenRouter's `openrouter:web_search` server tool and maps the answer plus standardized URL citations into `WebSearchResult`.

This implementation package registers into `ctx.web`; it does not own that service or register a model-facing tool. It resolves the OpenRouter credential for each search, records the secret-free auxiliary request in the initiating Agent session, and calls OpenRouter directly without depending on `ctx.llm`.

## Provider behavior

OpenRouter does not expose its hosted search engines as a standalone retrieval endpoint. The provider therefore makes one auxiliary model request. Its `engine: auto` default uses provider-native search when the selected model supports it and an OpenRouter-hosted engine otherwise. The model may search from zero to `maxUses` times; a response without any URL citation fails as `WEB_PROVIDER_ERROR` rather than degrading to URL extraction from prose.

The request always carries `provider.data_collection: deny`. `maxResults` becomes both `max_results` per search and `max_total_results` for the complete auxiliary request; `ctx.web` still enforces the final source bound independently.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal OpenRouter API key. A non-empty value wins; prefer `apiKeyEnv` so configuration contains no secret. |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or from the launch environment when that service is absent. A missing value fails as `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://openrouter.ai/api/v1` | Endpoint base; `/chat/completions` is appended. Falls back to `OPENROUTER_BASE_URL`. |
| `model` | `openrouter/auto` | Auxiliary OpenRouter model id. |
| `engine` | `auto` | `auto`, `native`, `exa`, `firecrawl`, `parallel`, or `perplexity`. |
| `maxTokens` | `4096` | Positive-integer generated-answer token cap. |
| `maxUses` | `5` | Positive-integer server-search cap and total server-tool-call cap. |

```yaml
- id: web-search-openrouter
  name: '@deepseek-ai/dsh-web-search-openrouter'
  config:
    apiKeyEnv: OPENROUTER_API_KEY
    model: openrouter/auto
    engine: auto
```

The Cordis entry is the base layer of the `web-search-openrouter` Settings section. A committed user layer affects the next search because each operation snapshots the whole effective section before credential resolution. `apiKey` has `role('secret')`, so `settings.describe()` exposes only whether that field is set; the credential literal is written and observed through `ctx.credentials`.

## Result mapping and failures

The first assistant message's non-empty text becomes `content`. Each `url_citation` annotation becomes a source: `url`, optional `title`, and optional `snippet` from the citation's `content`. Duplicate URLs retain their first citation. OpenRouter supplies no portable publication time in this response, so `publishedAt` is omitted.

Provider HTTP, network, invalid-response, and no-citation failures become `WEB_PROVIDER_ERROR`; caller cancellation becomes `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted. The direct provider result reports `truncated: false`; the `ctx.web` service owns final source truncation.

## Request logging

Immediately before dispatch, a search under an initiating Agent appends the log-only `web/openrouter-search-llm-request` event. It records the resolved endpoint and exact JSON body, including model, query instruction, server-tool parameters, token cap, and data-collection denial. Headers and credentials are excluded. Credential failures and cancellations before dispatch create no event; later request failures leave the attempt durable. A direct provider call outside an Agent has no initiating session to record into.

## Model Experience

### Auxiliary OpenRouter request

#### What the model sees

The auxiliary model receives `Use web search to answer this query with cited sources: <query>` as its sole user message and the configured OpenRouter web-search server tool. This request is separate from the conversation model's history.

#### Token effect

Each search incurs auxiliary model input and output tokens plus OpenRouter's selected search-engine charge. `maxTokens`, `maxUses`, `maxResults`, and `max_total_results` bound output, search count, and cited results.

#### KV Cache effect

The request is independent of the conversation cache. Model, tool configuration, and query changes establish a different auxiliary prefix.

### Conversation tool result

#### What the model sees

Through [`dsh-tool-web`](../tool-web/README.md), the conversation model sees the auxiliary answer and bounded deduplicated citations, or the provider's exact failure inside the consumer's error wrapper.

#### Token effect

Registration adds no conversation tokens. The answer and citations enter one tool result and remain in later requests until compaction.

#### KV Cache effect

The tool result is append-only and follows the reusable conversation prefix.

## Known Limitations and Deferred Work

- **OpenRouter search requires an auxiliary model turn** — the current server tool is not a standalone retrieval endpoint, and its API is beta.
- **The auxiliary model may decline to search** — the prompt requires cited web use, but OpenRouter's server-tool protocol leaves invocation to the model; a no-citation answer fails loud.
- **`auto` intentionally permits backend variation** — OpenRouter may use native search or a hosted engine, so latency, price, and available filters can change with the selected model and service routing.
- **Dynamic credential availability resolves inside execution** — synchronous `available()` can establish that a resolver exists but cannot query the asynchronous credential store; a selected keyless provider fails at operation time.
