---
id: REQ:web/openrouter-search
type: requirement
status: accepted
level: MUST
summary: Shipped web search uses OpenRouter without binding the harness to one search or model provider.
owners: [carlo]
refines: []
categorized_under: []
---

# OpenRouter web search

## Context

The shipped Web capability needs one routing-level search provider that reuses
the managed OpenRouter connection while keeping its auxiliary model request,
engine choice, citations, settings, and durable evidence behind the existing
provider-neutral Web service and stable tool.

:::{requirement id="openrouter-search" level="MUST"}
- {#c-default} Shipped compositions MUST register and select an OpenRouter-backed
  search provider, MUST reuse the managed `OPENROUTER_API_KEY` credential, and
  MUST contain no DeepSeek-specific search package, endpoint, credential, or
  settings namespace.
- {#c-routing} Each search MUST use OpenRouter's current web-search server tool
  through an explicitly configurable auxiliary model and search engine; the
  default engine MUST allow OpenRouter to choose provider-native search when
  supported and a hosted search engine otherwise.
- {#c-result} The provider MUST return the auxiliary answer and standardized URL
  citations through the existing provider-neutral `WebSearchResult`, MUST
  enforce the caller's result bound, and MUST fail when no citeable search
  result is returned.
- {#c-policy} The auxiliary request MUST deny provider data collection, resolve
  its credential for each operation, honor cancellation and time bounds, and
  record its exact secret-free request in the initiating session before
  dispatch.
- {#c-settings} Web Settings MUST edit the OpenRouter search credential,
  endpoint, auxiliary model, engine, and per-request search budget without
  exposing a credential literal through settings responses.
- {#c-evidence} Focused provider, session, settings, client, composition, and
  keyless assembled-application coverage MUST verify the replacement, and a
  real-API test MUST self-skip when `OPENROUTER_API_KEY` is absent.
:::
