# `@deepseek-ai/dsh-memory-sqlite`

English | [中文](README.zh.md)

SQLite Service Provider for durable reviewed memory. The configured absolute path is created with a monotonic application-owned schema; old, foreign, and unversioned non-empty databases fail closed. Compare-and-set mutations and supersession are transactional. Retention removes only old rejected or superseded project records; global deletion remains approval-owned.

## Model Experience

### Direct model context

#### What the model sees

Nothing directly. `dsh-memory-sqlite` registers no prompt, schema, result, or model request.

#### Token effect

Zero direct tokens; Consumers own any bounded records they add to model context.

#### KV Cache effect

No direct invalidation; Consumers own any bounded records they add to model context.

## Known Limitations and Deferred Work

- Search is SQLite substring matching. Ranked full-text search can replace it behind the Service Definition when measured corpus size requires it.
