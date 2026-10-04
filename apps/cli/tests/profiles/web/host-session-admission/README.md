---
description: "Keyless CLI Web Session-admission replay: original-prefix hydration, execution-only presets, request comparison, and process cleanup."
---

# Host Session admission snapshot support

## Summary

This fixture launches the shipped `dsh --profile web` through the [snapshot owner](../../../../../../snapshots/web/host-session-admission.snapshot.ts). Its [recorded Session](../../../../../../snapshots/web/host-session-admission/session.v3.jsonl) is synthetic Host history, both replay input and expected persisted output. It never uses a live model, personal Harness home, or browser.

## Table of Contents

- [Run the owner](#run-the-owner)
- [Round trip and controls](#round-trip-and-controls)
- [Dev Note](#dev-note)

## Run the owner

With current built artifacts, run the keyless owner from the repository root:

```sh
DSH_EXAMPLE_MODE=lib pnpm run test:snapshot -t 'host-session-admission'
```

The explicit refresh command regenerates the current Session generation and its prompt/schema pins from replay, without paid inference:

```sh
DSH_EXAMPLE_MODE=lib pnpm run test:snapshot:refresh -t 'host-session-admission.*resumes'
```

Live recording skips this authored case. The POSIX shell composition runs on Linux and macOS. [Shared snapshot support](../../../../../../packages/test-support/session-snapshot/README.md) owns canonical filenames, generation selection, normalization, and sidecar formats.

## Round trip and controls

The harness selects the highest parent generation, restores its prompt/schema tokens, and hydrates persistence envelopes with the official Session parser. The original prefix ends at the first `turn/end`. It copies that prefix into JSONL persistence under a private temporary Harness home, computes its finite digest with `fingerprintSessionPrefix`, and derives the continuation text and replay chunks from the remaining recorded events. No independent task or model-response script is maintained.

The ordinary logical preset and system-trusted host wrapper share every row from [logical.cordis.yml](logical.cordis.yml). The wrapper adds only isolated sandboxed Host filesystem, local subprocess, and sandboxed shell providers. Its different access default is a negative policy control: admission must retain the logical preset's access metadata and the original Session's read-only/never knobs.

The test overlay copies [probe.ts](probe.ts) into the private profile resolver directory. The supported CLI supplies its module dependencies, binds loopback port zero, and invokes the probe after successful application startup. The probe uses public `SessionController.create` with the existing identity, inspects the real `tool-bash` consumer's resolved shell via `executionContextForAgent`, and submits the deterministic continuation through `SessionController.prompt`. Routed replay consumption is checked for the resumed Session and a fresh ordinary logical counterpart. Their system prompts, tool schemas, and logged runtime-context content must match after matching policy knobs.

Invalid digest and unlisted known-Host controls reject before Agent publication or continuation work. The existing resume lifecycle may append its seed marker; no other appended event is accepted. Cancellation observes the assistant-stream start, calls public cancellation, and waits for whole-Agent idle and an aborted durable turn. Every run checks original header/prefix bytes and policy preservation, waits for CLI shutdown and persistence flush, then removes its owned home. The owner checks listener closure and home removal. No test uses a fixed port or readiness sleep.

## Dev Note

None.
