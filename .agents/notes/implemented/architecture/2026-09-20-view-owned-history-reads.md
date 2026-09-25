# Agent Note: View-owned history reads

Status: implemented

## Problem

A resident Session keeps its follow stream and accepted event window after navigation. Disposing a conversation projection therefore does not cancel a pending history read. A late page or detail can otherwise hydrate a hidden view or publish an obsolete error after another view has replaced it.

## Decision

The first active page or detail caller may provide its view's AbortSignal. Coalesced callers share that request and cancellation lifetime. Cancellation releases the active coalescing slot before notifying the transport, while retaining ownership of its completion until settlement. Session teardown joins all reads, including canceled reads whose carriers are still settling. Cancellation leaves live follow, accepted events and Host work intact.

Gateway binds each page to its logical stream, physical generation and caller using the composition's portable AbortController factory. It also records the accepted window revision, so a gap repair cannot receive an older page's result or failure. A caller must explicitly request another page after cancellation or reconnect.

## Alternatives considered

**Dispose the Session when closing a view.** Resident Sessions keep ongoing work and shared event sources independent of the selected UI.

**Ignore the result only in the UI.** The shared Session would still publish and retain the response, and the transport would keep running.

**Race cancellation against the read promise.** Returning early would hide a still-running carrier from Session teardown.

## Consequences

The caller aborts its controller on view replacement and waits for returned read promises during final teardown. Coalesced observers cannot cancel independently. Omitting the signal preserves ordinary Web calls; existing Session replacement and disposal lifetimes still apply.
