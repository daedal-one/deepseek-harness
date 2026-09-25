# Agent Note: Caller-owned fork identity

Status: implemented

## Problem

A Host-allocated child id disappears with a lost fork reply. Parent and title matches cannot distinguish concurrent forks. Workspace attachment can fail after child publication, and a title rename is a separate mutation that can also fail after a usable child exists.

## Decision

The optional `session/forkTo` operation requires a fresh child identity retained by its caller. It shares completed-turn cutting and Agent creation with `session/fork`, while leaving that endpoint's wire and behavior unchanged. The live Session registry and persistence provider enforce collision refusal. The operation never adopts or overwrites an existing identity and never renames the child. Shared Client errors retain the requested identity, while only success and the structured Workspace attachment failure publish a local list row.

The existing shared summary reader can resolve the exact current child after an uncertain reply. Such a read establishes current identity and lineage, not causal proof that a prior request completed every step. The reader must not infer a fork from a matching parent or title, nor treat absence as permission to repeat a mutation. Native callers need their own durable pre-dispatch journal and explicit review of current child state before exposing recovery controls.

## Alternatives considered

**Automatically resend the old operation.** The Host allocates another child and may duplicate the user's fork.

**Adopt an existing id on a repeated request.** Matching identity alone does not prove the same source, anchor, Workspace outcome or creation attempt. Collision refusal preserves the existing Session and keeps uncertainty visible.

**Change the existing fork request.** A separate optional generated method preserves installed callers' fingerprint and semantic revision and lets native consumers admit the new behavior independently.

**Record another Session event or header field.** Current-child inspection needs no new durable representation. This operation makes no stronger exactly-once or original-request-acceptance claim that would require a separate durable receipt.

## Consequences

The caller can name the child before dispatch and inspect it without another fork. A title change remains separately attributable to that child. Existing Session data and the model-visible inherited prefix remain unchanged. Completed-turn rules and prefix reuse retain their existing owners; this note does not supersede [fork prefix behavior](2026-08-10-fork-children-stay-one-shot.md) or [Session migration evidence](2026-09-09-fork-session-evidence-migration.md). A missing child may still appear after a delayed request, so unknown outcomes remain unresendable.
