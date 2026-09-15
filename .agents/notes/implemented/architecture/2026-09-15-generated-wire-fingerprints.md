# Agent Note: Generated wire schema fingerprints

Status: implemented

## Problem

An endpoint name or type symbol can remain unchanged while its argument or result codec changes. Capability envelope versions identify metadata fields, and Session format versions identify durable data; neither demonstrates domain schema compatibility between an installed phone and its Host.

## Decision

The Typert emitter hashes one endpoint's resolved schema projection and invocation fields into a versioned wire fingerprint shared by Host and Client artifacts. It uses the same schema emitter as runtime codecs, includes transitive references and allocates canonical declaration names by first use. Source paths, symbol spelling, prose, internal implementation names and unrelated endpoints are excluded. Wire fields, order, absence, lookup and Context selection, cancellation, result codecs and readonly parsing effects remain significant. The algorithm version changes when canonical projection semantics change.

Capability metadata version 2 preserves these optional fingerprints. Missing fingerprints mean unverified schema evidence; manually registered descriptors do not acquire a fabricated checksum. The Loader rejects malformed fingerprints before registration. The portable reader validates them on the wire alongside Host and activation identities.

## Alternatives considered

**Hash type names.** A name survives changes to the referenced type and cannot detect incompatible payloads.

**Hash the whole generated package.** Unrelated methods, source paths and documentation would invalidate every endpoint in an installed Client.

**Maintain a second schema serializer.** Its accepted values could diverge from the executable codec projection.

## Consequences

Equality is conservative generated-schema evidence, not semantic subtyping or proof of business behavior, permission, Session format or event vocabulary. Declaration structure and property/union order can cause conservative mismatches. The [operation compatibility decision](2026-09-16-remote-operation-compatibility.md) owns business revisions and dispatch enforcement; generation-level admission remains independent. This decision extends the schema-evidence gap in [capability discovery](2026-09-15-host-capability-discovery.md); its authorization and availability reasoning remains active.
