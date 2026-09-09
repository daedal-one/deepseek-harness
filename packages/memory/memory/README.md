---
description: "Query and maintain scoped memory through one provider-neutral service."
kind: "package-reference"
---

# `@deepseek-ai/dsh-memory`

## Summary

Query and maintain scoped memory through one provider-neutral service. Records carry evidence, trust, validity, and contradiction links; identifiers and revisions prevent cross-scope or stale writes. A mounted provider owns persistence.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Service Definition for durable reviewed memory. Every operation names either one canonical project path or the global scope; ids and revisions prevent cross-scope and stale writes. Proposals carry evidence, trust, temporal validity, and explicit contradiction links.

No invariant companion is published because the selected provider owns record and revision consistency.

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

### Dev Note

None.
