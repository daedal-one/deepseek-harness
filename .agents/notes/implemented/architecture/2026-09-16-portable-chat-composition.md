# Agent Note: Shared portable Chat business registration

Status: implemented

## Problem

The portable Conversation engine accepts a Session event window, but the Chat target's registration entry requires the browser Context. Native presentation needs the same business interpretation, including surface replacement, Assistant settlement, process facts and unknown-event fallback. Repeating the Definition list or projection in the frontend would create another authority for those semantics.

## Decision

Chat has one renderer-independent registration function. It receives scoped Conversation registries and the shared pure prompt inspectors. The browser plugin passes its traced service, preserving contribution ownership; portable callers pass registries owned by their composition Context. Both install the same ordered Definitions, fallback and snapshot builder. Individual one-call registration wrappers have no remaining caller and are removed. Workspace outcomes follow this same registration and declaration path, so returned and pending save receipts cannot disappear from portable consumers while remaining visible in Web.

The portable declaration entry retains the installed business modules' type augmentations. Runtime registration alone cannot retain a discriminated Chat vocabulary in emitted declarations because implementation-only imports can be erased. Conversation extension maps have one canonical `./client/types` outlet; contributions augment that owner so both public faces observe the same entries. Chat remains the business owner; the Remote API service owns neither its Definitions nor its rendering.

The [Conversation assembly decision](2026-08-09-client-conversation-node-assembly.md) continues to own incremental business interpretation. The [portable binding decision](2026-09-16-portable-conversation-assembly.md) continues to own event-window subscription and publication. Neither is superseded.

## Alternatives considered

**Interpret events in the mobile app.** The native transcript would maintain independent replacement, settlement and ordering rules.

**Load the browser plugin.** Registration would retain browser rendering and attachment presentation dependencies.

## Consequences

Registries reject duplicate contributions. The caller owns failed registration-scope cleanup, registry-change rebuilds and final disposal. The portable entry supplies data and registration, not a native screen or independently qualified installation. Device interaction and release acceptance remain separate evidence.
