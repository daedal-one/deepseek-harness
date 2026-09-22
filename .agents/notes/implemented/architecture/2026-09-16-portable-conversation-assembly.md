# Agent Note: Portable Conversation subscription ownership

Status: implemented

## Problem

The native Session client exposes the authoritative event window, but its observable Conversation binding shares a module with browser image URL ownership. Loading that service in another renderer would couple transcript assembly to browser facilities or invite a second event projection.

## Decision

The event-window binding and shared assembler have an ordinary ESM entry independent of the browser service. The browser service consumes that same binding. Publication scheduling belongs to the platform adapter; the browser keeps its three-paint cadence and consumers without a frame clock can request immediate publication. Cancellation invalidates a publication epoch before cancelling platform work, so a queued callback cannot flush a newer window or a disposed binding.

The [Conversation Node assembly decision](2026-08-09-client-conversation-node-assembly.md) continues to own business Definitions, target activation and incremental assembly. The [Session and Conversation ownership decision](2026-08-20-client-session-conversation-ownership.md) continues to own the shared event window. Neither decision is superseded by the portable binding.

## Alternatives considered

**Project Session events in the frontend repository.** History replacement, pagination, transient Assistant settlement and target semantics would have independent implementations.

**Load the browser service on native.** Editor, rendering and image URL ownership would remain coupled to a read-side model.

## Consequences

Portable consumers own Definition registration and disposal, registry rebuild notification, target subscriptions and binding disposal. The binding exposes observable read faces without granting mutation access to its snapshot store. Target-specific business Definitions and native presentation remain separate consumers. A portable import or deterministic scheduler test does not establish authenticated iPhone behavior.
