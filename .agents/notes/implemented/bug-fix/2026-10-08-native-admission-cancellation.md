# Agent Note: Native admission cancellation owns work before invocation

Status: implemented

## Problem

A cancelled forwarded-event opening can arrive from an already pending iterator. Eager capability admission then creates a rejecting Promise before the cancellation helper can observe it, leaving an unhandled rejection during client disposal.

## Decision

The Gateway cancellation helper accepts an operation closure. It observes cancellation before invoking the closure and owns the resulting Promise through the abort race. Capability admission and scoped waterfall delivery use that owner. The [operation compatibility decision](../architecture/2026-09-16-remote-operation-compatibility.md) independently owns descriptor matching and remains active.

## Alternatives considered

**Contain the rejection in the caller.** This still starts expired work and requires every caller to reproduce ownership.

**Wait for an expired admission read before closing.** A carrier that ignores cancellation can prevent disposal indefinitely.

## Consequences

Cancelled operations start no new work. Work already invoked may still settle after cancellation, with its rejection observed by the race. Cancellation does not imply that a dispatched mutation did not execute.
