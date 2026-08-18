# Agent Note: OpenRouter-routed web search replaces the DeepSeek-specific provider

Status: implemented

English | [中文](2026-08-18-openrouter-web-search.zh.md)

## Problem

The shipped `web_search` path depended on DeepSeek's Anthropic-compatible Messages endpoint and native search tool. That made one vendor's credential, endpoint, model vocabulary, request fields, response blocks, and availability part of the default deployment even though `ctx.web` and the model-facing tool were already provider-neutral. It also required a second account beside the OpenRouter route used for conversation models.

OpenRouter exposes web search as a server tool on model requests, not as a standalone retrieval endpoint. Its automatic engine can select provider-native search when the chosen model supports it and use an OpenRouter-hosted engine otherwise. Replacing the provider therefore still requires an auxiliary model turn, explicit result normalization, durable request evidence, and a failure when the model returns an uncited answer.

## Decision

The base bundle selects `openrouter` and mounts `@deepseek-ai/dsh-web-search-openrouter`. The removed `@deepseek-ai/dsh-web-search-deepseek` package and its configuration have no compatibility reader because the repository is pre-release.

Each search sends one Chat Completions request containing the `openrouter:web_search` server tool. The configurable model defaults to `openrouter/auto`, and the engine defaults to `auto`; deployments may choose `native`, `exa`, `firecrawl`, `parallel`, or `perplexity`. `maxResults` becomes both the per-search and total-result bound, while `maxUses` bounds server searches and total server-tool calls. The request always denies provider data collection.

The provider reuses `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL`, resolving the credential for every operation through `ctx.credentials` when available. Conversation traffic and search remain separate requests: the search provider calls OpenRouter directly behind `ctx.web` and does not expand the generic LLM seam with server-tool behavior.

The first assistant message becomes the optional generated answer. Standardized `url_citation` annotations become deduplicated `WebSearchSource` values. A response without any citeable URL fails as `WEB_PROVIDER_ERROR`; parsing links from answer prose is not a fallback. Immediately before dispatch, the provider appends `web/openrouter-search-llm-request` with the resolved endpoint and exact secret-free body to the initiating Agent session. HTTP redirects fail before a private query body can reach another origin.

The Web Plugins card edits the OpenRouter search namespace's credential reference, endpoint, auxiliary model, engine, and search budget. Committed settings affect the next operation from one snapshot, so credential resolution cannot mix one revision's key with another revision's endpoint.

## Alternatives considered

**Keep DeepSeek native search beside the OpenRouter default.** Rejected because the shipped path would still require a second provider account and preserve two default routing systems. Exa and Perplexity remain opt-in implementations behind `ctx.web` for deployments that want a direct vendor contract.

**Call a standalone OpenRouter search endpoint.** Rejected because the service exposes search as a server tool attached to a model request. Inventing a retrieval endpoint would make the adapter depend on an unsupported protocol.

**Use only `engine: native`.** Rejected because it would make model selection and search availability inseparable. `auto` prefers native provider search and retains a hosted fallback; deployments that require one engine can select it explicitly.

**Accept an uncited answer.** Rejected because the portable result requires attributable sources. Prose URL extraction cannot distinguish citations from incidental links and would make provider failures appear successful.

**Route the auxiliary request through `ctx.llm`.** Rejected because the generic LLM seam does not represent OpenRouter server tools or their citation annotations. The provider-private request remains reconstructable through its session event without widening conversation-model transport.

## Consequences

The default deployment needs one OpenRouter credential for conversation and web search, while the stable `web_search` tool and `ctx.web` provider contract remain unchanged. OpenRouter can route retrieval across native and hosted engines, so the shipped path is no longer tied to DeepSeek search, but cost, latency, and engine behavior may vary under `auto`.

Every search incurs an auxiliary model request plus the selected search engine's charge. The exact request is durable without credentials, provider data collection is denied, redirects are rejected, and no-citation responses fail loud. The assembled browser snapshot uses the real provider against a local OpenRouter-compatible endpoint and verifies the request, durable event, source cap, and presentation without external network access.
