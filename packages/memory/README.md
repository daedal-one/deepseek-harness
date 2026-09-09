---
description: "Store project or global knowledge with evidence and an explicit review lifecycle."
kind: "package-group"
---

# memory/ — durable reviewed-memory capability family

## Summary

Store project or global knowledge with evidence and an explicit review lifecycle. Ordinary Agent tools can propose and retrieve records; a principal-authorized reviewer accepts, supersedes, or deletes them. The SQLite provider retains records and revisions across sessions.

## Table of Contents

- [Use this group](#use-this-group)
- [Dev Note](#dev-note)

-----

## Use this group

This family stores evidence-backed project or global knowledge, keeps extracted statements pending until review, and exposes ordinary and principal-authorized model tools.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Defines scoped records, lifecycle operations, and provider selection | `ctx.memory` |
| [`memory-sqlite/`](memory-sqlite/README.md) | Persists reviewed memory in an application-owned SQLite schema | registers on `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | Exposes ordinary query, read, proposal, challenge, and checkpoint tools | registers on `ctx.tools` |
| [`tool-memory-reviewer/`](tool-memory-reviewer/README.md) | Installs pending discovery, review, supersession, and deletion only in the configured principal child | registers on child `ctx.tools` |
| [`memory-extractor-llm/`](memory-extractor-llm/README.md) | Creates bounded project proposals after committed completed turns | appends extraction events and calls `ctx.memory` |

The [memory subsystem reference](../../docs/subsystems/memory.md) defines the provider-neutral data and service API. The [durable reviewed-memory Agent Note](../../.agents/notes/implemented/feature/2026-08-16-durable-reviewed-memory.md) owns the review, authorization, approval, extraction, and persistence decisions.

### Dev Note

None.
