---
description: "The shared read of OpenRouter's public model catalog: pure reply parsing, raw-price conversion, a bounded TTL cache, and the failure-mapped network boundary, consumed by both the spend report and model routing."
kind: "package-library"
---

# @deepseek-ai/dsh-openrouter-catalog

## Summary

One implementation of the OpenRouter catalog read, so two consumers cannot disagree about what a model costs. `dsh-openrouter-spend` prices a session's durable token buckets with it, and `dsh-model-catalog-openrouter` turns its entries into routing candidates.

The package is a library, not a plugin: it registers no service, holds no state outside an explicit cache instance, and declares no Cordis context key. A consumer constructs the cache it needs and calls the read itself.

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

Parse a catalog reply you already have, price one model, or perform the read:

```ts
import { TtlCache, findModelPricing, parseModelsReply, readModels, usdPerToken } from '@deepseek-ai/dsh-openrouter-catalog'

const parsed = parseModelsReply(await response.json())
if (parsed.ok) {
  const pricing = findModelPricing(parsed.value, 'deepseek/deepseek-v4.1-flash')
  const promptUsdPerToken = pricing === null || pricing === undefined ? null : usdPerToken(pricing.prompt)
}
```

`readModels` performs `GET {baseURL}/models` and returns the parsed entries or a mapped failure. It sends no credential: the public catalog needs none, and the Authorization header is only ever added by an authenticated read that passes a key.

### Caching

The package ships a bounded TTL cache rather than a module-level one, so each consumer owns its own freshness policy:

```ts
const cache = new TtlCache<readonly OpenRouterModelCatalogEntry[]>(60_000)
const entry = await cache.read(async () => {
  const result = await readModels(options, signal)
  if (!result.ok) throw new Error(result.error.detail)
  return result.value
}, value => value.length > 0)
```

Concurrent callers sharing a stale cache share one in-flight read, and a non-cacheable result leaves no slot so the next call retries immediately.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Why this is a package and not part of the spend report

The spend report is a Remote-only service whose presence on the loop's dependency path was deliberately avoided. Routing needs the same catalog and the same price arithmetic, so the shared half lives here and both consumers depend on it. Neither consumer depends on the other.

### Failure mapping

`readEndpoint` maps `401`/`403` to `unauthorized`, `429` to `rate-limited`, any other non-2xx status or a thrown fetch to `unreachable`, and a body that is not JSON or fails its parser to `malformed-response`. No failure detail carries the credential, the URL, or any part of either.

### Price strings are not numbers until checked

`usdPerToken` treats `-1` — OpenRouter's pass-through marker — and every blank, negative, non-finite, or non-numeric price as unpriceable rather than zero. A consumer that needs a cost treats null as "cannot be computed honestly" instead of substituting a value.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Failure vocabulary, raw pricing slots, catalog entries, read options |
| [`src/parse.ts`](src/parse.ts) | Pure `parseModelsReply`, `findModelPricing`, and `usdPerToken` |
| [`src/read.ts`](src/read.ts) | `readEndpoint` failure mapping, `endpointOf`, and the public `readModels` |
| [`src/cache.ts`](src/cache.ts) | `TtlCache`: bounded TTL with in-flight de-duplication |
| [`src/index.ts`](src/index.ts) | Package entry re-exporting the above |
| — | No invariant companion is published; every decision is a pure function of a reply body, and the only state is a cache the caller owns. |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-openrouter-spend`](../openrouter-spend/README.md) prices durable session usage with this read and owns the authenticated `/key` half.

## Model Experience

None, as the OpenRouter catalog read registers no prompt section, tool schema, or message content.

#### KV Cache effect

None; this package neither assembles nor sends a model request. It parses a provider reply and converts published price strings.

## Known Limitations and Deferred Work

- Only the model catalog and its prices are read here. The authenticated `/key` endpoint stays with the spend report, because nothing else consumes it.
- The reply parse keeps the model id and its four price slots. Context capacity, reasoning support, and input modalities are not read from OpenRouter at all; the routing provider takes those from the installed adapter catalog, which is the authority on what a route can actually do.
- The cache is per instance and is never shared across consumers, so two consumers with the same TTL can each hold a copy of the same catalog.

### Dev Note

None.
