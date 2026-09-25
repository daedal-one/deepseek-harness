---
description: "Remote read of the configured OpenRouter inference key's spend and the requested session's estimated USD cost: the openrouterSpend service and its openrouterSpend/read Remote for web GUI host clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-openrouter-spend

## Summary

Clients can call `openrouterSpend/read` to display the spend of the configured OpenRouter inference key — total, daily, weekly, and monthly usage against its limit — beside the requested session's estimated USD cost, priced from OpenRouter's public model catalog against every settled request's durable actual route. Each response is a point-in-time snapshot: the key reading is cached for a configurable lifetime, the credential is resolved per read, and a session estimate that cannot be computed honestly is reported as unpriceable rather than as a fabricated zero.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Call `openrouterSpend/read` with one `sessionId` when a client or settings page wants to show what the configured OpenRouter key has spent and what the open session has cost so far. The Remote is the only entry point: the service is Remote-only and deliberately declares no same-process Cordis `Context` merge, so a Host composition that needs these numbers reads them through the Gateway like any other Remote.

### What a read returns

The `key` half reports the inference key's label, its usage in USD for the current day, week, and month plus total usage, its configured limit and remaining headroom (each `null` when the key is unlimited), and whether it is on the free tier. The `session` half reports the latest durable selection — provider and model — and its estimated cost; it is `null` when the session is not live or has no model selection yet. `costUsd` is `null` whenever the cost cannot be computed honestly from available catalog data: any child-owned settled usage lacks durable route attribution, any route is outside OpenRouter, a routed model has no catalog entry, or a required price is unavailable. A failed catalog read preserves its distinct failure instead. `fetchedAt` is the actual epoch milliseconds when the cached key reading completed.

A read fails as a whole when the key or required catalog reading fails: `not-configured` when no credential is available, `unauthorized` for HTTP 401/403, `rate-limited` for HTTP 429, `unreachable` for timeouts and other non-2xx answers, and `malformed-response` when OpenRouter answers with a body the reply cannot be parsed from. No failure detail carries the credential.

### Configuration

The service takes four optional fields, each with a schema default: `credentialRef` (default `OPENROUTER_API_KEY`), `baseURL` (default `https://openrouter.ai/api/v1`), `cacheTtlMs` (default 60000), and `requestTimeoutMs` (default 10000).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The service projects one question — "what has this key spent, and what has this session cost?" — from three sources: the OpenRouter `GET /key` endpoint (which a normal inference key may call, so no management key is ever required), OpenRouter's public unauthenticated `GET /models` catalog, and the session's durable model selection, request headers, assistant-message sources, and settled usage. The key reading and the catalog are cached in two independent bounded TTL caches that de-duplicate concurrent reads into one in-flight request each; the key cache invalidates when the in-memory credential fingerprint changes, and a failed load occupies neither cache. Pricing is pure: exact per-token catalog prices multiply each route-attributed settled usage's four disjoint token buckets, then sum without rounding.

### Failure mapping

`401`/`403` map to `unauthorized`, `429` to `rate-limited`, any other non-2xx status, timeout, or network failure to `unreachable`, and a body that fails its pure parser to `malformed-response` with the parser's field-naming detail. No live session or selection degrades `session` to `null`; missing route attribution, a non-OpenRouter route, no catalog entry, or an unpriceable listed price degrades `costUsd` to `null`. A catalog transport or response failure preserves its mapped failure reason for the client.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Package entry: the service, its `Config`, and the public type vocabulary |
| [`src/service.ts`](src/service.ts) | `OpenRouterSpendService`: the `openrouterSpend` Remote service, credential resolution, and the two cached reads |
| [`src/types.ts`](src/types.ts) | Public payload types: `OpenRouterKeyUsage`, `OpenRouterSpendSnapshot`, `OpenRouterSpendReadResult` |
| [`src/api.ts`](src/api.ts) | Pure parsing of the `/key` and `/models` reply bodies |
| [`src/pricing.ts`](src/pricing.ts) | Pure USD math over raw catalog price strings |
| [`src/cache.ts`](src/cache.ts) | Bounded TTL cache with in-flight de-duplication |
| [`src/openrouter.ts`](src/openrouter.ts) | The network boundary: the two GET reads and their failure mapping |
| — | No runtime invariant companion is published; every value is projected from OpenRouter or from projection-owned session state. |

Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the spend contract is not enough: how the Remote reaches clients, then the seams that supply the session half.

- [Remote assembly](../../api/remotes/README.md) — how clients consume `openrouterSpend/read` without importing the Host implementation.
- [Session log](../../core/session/README.md#request-headers) — the durable request headers and settled attempts that attribute historical cost.
- [Session projections](../../session/session-projection/README.md) — the durable `modelSelection` read that names the current display route.
- [Credentials](../../credentials/credentials/README.md) — how the configured key reference resolves per read.

-----

<a id="model-experience"></a>
## Model Experience

None, as the host-side read-only spend projection registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a model request. It only reads OpenRouter's key and catalog endpoints and prices already-logged token buckets.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a point-in-time spend read cannot tell a client. They are current package constraints, not a task backlog.

- **No management-key or account-credits support, by design** — the service reads `GET /key` with a normal inference key; OpenRouter's management-only credit endpoints are never called, so account-level balances are out of scope.
- **No background refresh** — there is no refresh interval or push; every read happens per call, and two calls within the cache TTL share one underlying OpenRouter read.
- **Attribution and listed-price gaps remain unpriceable** — missing durable request attribution, a non-OpenRouter route, a missing catalog entry, or a routed price (`-1` or blank) leaves the session estimate explicitly unpriceable (`costUsd: null`) rather than inventing a number; a failed `/models` read remains a distinct read failure.
- **Catalog prices are public-catalog prices** — they describe the model's listed route, not the exact routed provider a request actually took, so the estimate is a display figure, not a billing figure.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
