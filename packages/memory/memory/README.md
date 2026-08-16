# `@deepseek-ai/dsh-memory`

English | [中文](README.zh.md)

Service Definition for durable reviewed memory. Every operation names either one canonical project path or the global scope; ids and revisions prevent cross-scope and stale writes. Proposals carry evidence, trust, temporal validity, and explicit contradiction links.

## Model Experience

### Direct model context

#### What the model sees

Nothing directly. `dsh-memory` registers no prompt, schema, result, or model request.

#### Token effect

Zero direct tokens; Consumers own any retrieved memory added to model context.

#### KV Cache effect

No direct invalidation; Consumers own any retrieved memory added to model context.

## Known Limitations and Deferred Work

- The runtime selects exactly one provider. Cross-provider federation is intentionally unsupported until a current Consumer requires ordering semantics.
