# Agent Note: Search hit admission through Session summaries

Status: implemented

## Problem

A bounded Session list may omit a valid content-search hit. Its snippet establishes a match but carries neither the list metadata nor a direct-parent address required to construct a shared Session binding.

## Decision

The existing [Client ownership layers](2026-08-20-client-session-conversation-ownership.md) keep metadata in the Controller. The shared Client [Session list owner](../../../../packages/api/session-controller/src/client/sessions/manager.ts) admits the requested row through the existing Host list reader's includeSessionId option. Search results remain request-local. Loading a summary changes neither selection nor list pagination, and preserves established row metadata. The [public facade](../../../../packages/api/session-controller/src/client/contract/sessions.ts) publishes addressability before a present result resolves; opening history remains an explicit operation.

Live mutations during a summary read are replayed over its reply. The admitted row also enters an overlapping list read's mutation journal, so either completion order preserves it. Deletion wins over an earlier reply. Caller cancellation, connection-generation replacement and disposal suppress late publication; disposal waits for every owned carrier read to settle.

## Alternatives considered

Synthesizing metadata from a search snippet would give search a second list authority. Loading every continuation page would make opening one hit depend on catalog size. Selecting an unknown identity to force its inclusion would change navigation before the Host validates presence. The existing bounded list request avoids these costs without a new endpoint.

## Consequences

A summary lookup can return absence independently of a retained list row, and callers must respect that result. It does not assert durable deletion or clear established metadata. Request-local errors cannot erase a usable list. The Host and existing clients retain their wire requirements; native search presentation still owns its optional search admission and caller lifetime.
