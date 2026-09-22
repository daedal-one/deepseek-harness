# Agent Note: Native generation admission

Status: implemented

## Problem

A matching paired Host identity does not establish that a Client can operate its required features. Publishing readiness before asynchronous capability discovery lets forwarded events and application controllers use a generation whose API has not been accepted.

## Decision

The portable Client requires an explicit selection of endpoint requirements. The application facade derives mode, wire fingerprint and business revision from the same generated contributions it mounts, before Gateway startup. Optional endpoints remain outside that selection; an explicit empty selection supports metadata-only compositions.

Gateway validates the paired event-stream opening, then reads capabilities for that exact activation and cancellation lifetime. Missing, unavailable or incompatible required endpoints refuse readiness. Context-required endpoints pass this metadata check because concrete Context resolution belongs to the later operation. Notifications wait behind admission, and the full accepted snapshot is exposed only while its generation remains active. Cancellation races the capability read so disposal does not depend on a late carrier response; the read itself also refuses cancelled results. Reconnection always reads fresh metadata.

## Alternatives considered

**Read the mounted registry at connection startup.** Contribution mounting is asynchronous and may start after Gateway installation; the required set would depend on installation timing.

**Require every generated Remote.** Optional Host plugins would prevent basic Session use even when the Client does not require them.

**Cache by paired Host id.** Restarts and contribution reloads can change API evidence while retaining the durable Host identity.

## Consequences

The native UI composition owns its required feature selection. Admission does not grant permissions, prove concrete Context availability or replace Session format and event-vocabulary checks. Live [operation compatibility](2026-09-16-remote-operation-compatibility.md) remains authoritative after admission. The existing Web composition retains its origin-authorized generation path during migration.

Cold native startup can mount read projections before the first Host generation exists. Absence and loss therefore use the supervised stream carrier-failure classification; a plain terminal error would permanently stop those projections before admission. A present generation with a different Host still refuses terminally. This classification does not retry unary commands.
