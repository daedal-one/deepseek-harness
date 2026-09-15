# Agent Note: Remote operation compatibility

Status: implemented

## Problem

A stored capability snapshot can become stale after a Host contribution reloads. Equal schemas also cannot reveal a changed business meaning. An installed native Client needs both expectations checked where the Host selects the method, before Context or lookup resolution can perform work.

## Decision

The generator resolves each Remote method's business revision from one positive safe integer `@remoteRevision` annotation, with initial revision 1. The annotation belongs to the method's public JSDoc and travels through generated Host and Client descriptors independently of schema hashing. The [generator policy](../../../../packages/typert/generator/README.md#business-revisions) defines changes requiring an increment. Capability envelope 3 preserves both optional evidence fields.

Generated Clients send schema and business expectations with each operation. Native calls also bind the paired Host activation and refuse absent evidence locally. The Host compares expectations before Context or lookup resolution, then rechecks the exact live descriptor immediately before invoking the method after asynchronous preparation. Reload during preparation refuses the request, including a replacement with identical metadata. Accepted operations retain the selected method. Refusal is a typed `gateway/api-incompatible` outcome, and neither carrier replays the command.

## Alternatives considered

**Use only the schema checksum.** Unchanged payloads can acquire incompatible effects, permission meaning or result interpretation.

**Trust an earlier capability snapshot.** A Host can reload a method after discovery and before a mutation arrives.

**Use one global application version.** Unrelated feature releases invalidate every method and couple frontend branding to business compatibility.

## Consequences

Revision correctness requires review of observable behavior; generation validates the declaration but cannot infer semantics. Compatibility is opt-in for existing unnegotiated source and Web callers and mandatory for native generated calls. It grants no authority and does not prove required Session event support. Generation-level required-capability admission remains independent. The earlier [wire fingerprint](2026-09-15-generated-wire-fingerprints.md) decision still owns canonicalization, and [capability discovery](2026-09-15-host-capability-discovery.md) still owns advisory availability.
