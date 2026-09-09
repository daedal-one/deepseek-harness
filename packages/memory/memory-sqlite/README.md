---
description: "Retain scoped memory records and review revisions in SQLite."
kind: "package-reference"
---

# `@deepseek-ai/dsh-memory-sqlite`

## Summary

Retain scoped memory records and review revisions in SQLite. Choose this provider when reviewed knowledge must survive session and process restarts. Database format changes use an application-owned schema version.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

SQLite Service Provider for durable reviewed memory. The configured absolute path is created with a monotonic application-owned schema; old, foreign, and unversioned non-empty databases fail closed. Compare-and-set mutations and supersession are transactional. Retention removes only old rejected or superseded project records; global deletion remains approval-owned.

No invariant companion is published because database transactions enforce record and revision consistency.

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

### Dev Note

None.
